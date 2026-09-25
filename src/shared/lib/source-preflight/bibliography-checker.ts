import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

import { STO_RULES } from '@/shared/config';
import { resolveBibliographyPath } from '@/shared/lib/bibliography-path';
import { parseCitationReferences } from '@/shared/lib/citation-syntax';
import { ReportConfig } from '@/shared/lib/report-config';

import { validateManualBibliographyContent } from './bibliography-content-checker';
import { isFutureDate, parseIsoDate } from './bibliography-date';
import {
	BibEntrySource,
	getNormalizedTagValue,
	hasAnyBibTag,
	readBibEntrySources,
	readBibTagValue,
} from './bibtex-source';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

function collectCitationKeys(
	content: string,
	onInvalid?: (message: string, line: number) => void,
): string[] {
	const keys = new Set<string>();
	for (const match of content.matchAll(/\[@([^\]]*)]/g)) {
		try {
			for (const { key } of parseCitationReferences(match[1])) {
				keys.add(key);
			}
		} catch (error) {
			onInvalid?.(String(error), lineNumberAt(content, match.index ?? 0));
		}
	}
	return [...keys];
}

function collectAllCitationKeys(
	files: SourceFile[],
	issues?: SourcePreflightIssue[],
): string[] {
	return [
		...new Set(
			files.flatMap(({ file, content }) =>
				collectCitationKeys(content, (message, line) => {
					issues?.push(
						issue('citation-invalid-syntax', message, file, line),
					);
				}),
			),
		),
	];
}

function readMetadata(files: SourceFile[]): Record<string, unknown> {
	for (const source of files) {
		const parsed = matter(source.content);
		if (Object.keys(parsed.data).length > 0) {
			return parsed.data as Record<string, unknown>;
		}
	}
	return {};
}

function bibliographyPathFromMetadata(
	files: SourceFile[],
	sourceDir: string,
	cwd: string,
): string {
	const metadata = readMetadata(files);
	const rawPath =
		typeof metadata.bibliography === 'string'
			? metadata.bibliography
			: 'references.bib';
	return resolveBibliographyPath(rawPath, sourceDir, cwd);
}

const ONLINE_ENTRY_TYPES = new Set(['online', 'inonline']);
const ONLINE_SUBTYPES = new Set(['online', 'electronic']);

function formatRequiredFieldGroup(tagNames: readonly string[]): string {
	return tagNames.join(' or ');
}

function isOnlineEntry(entry: BibEntrySource): boolean {
	return (
		requiresNetworkUrl(entry) ||
		hasAnyBibTag(entry, ['url', 'urldate', 'website'])
	);
}

function requiresNetworkUrl(entry: BibEntrySource): boolean {
	return (
		ONLINE_ENTRY_TYPES.has(entry.entryType) ||
		(entry.entryType === 'misc' &&
			ONLINE_SUBTYPES.has(
				getNormalizedTagValue(entry, 'entrysubtype')?.toLowerCase() ??
					'',
			))
	);
}

function validateUrlAccessDates(
	bibPath: string,
	citationKeys: readonly string[],
	entries: readonly BibEntrySource[],
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	const urldatePattern = new RegExp(STO_RULES.bibliography.urldatePattern);
	for (const entry of entries) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const url = readBibTagValue(entry, 'url');
		if (!url) {
			continue;
		}
		if (/\s/.test(url)) {
			issues.push(
				issue(
					'bibliography-url-contains-whitespace',
					`cited electronic resource @${entry.key} has whitespace in URL. Enter the exact address without spaces or line breaks.`,
					path.basename(bibPath),
					entry.line,
				),
			);
			continue;
		}

		const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
		if (
			!protocol ||
			!STO_RULES.bibliography.urlProtocols.includes(protocol)
		) {
			issues.push(
				issue(
					'bibliography-url-missing-protocol',
					`cited electronic resource @${entry.key} has URL without supported protocol (${STO_RULES.bibliography.urlProtocols.join(', ')}).`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}

		const urldate = readBibTagValue(entry, 'urldate');
		if (!urldate) {
			issues.push(
				issue(
					'bibliography-url-missing-urldate',
					`cited electronic resource @${entry.key} has url, but no urldate/date access field.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
			continue;
		}

		if (!urldatePattern.test(urldate) || !parseIsoDate(urldate)) {
			issues.push(
				issue(
					'bibliography-urldate-invalid-format',
					`cited electronic resource @${entry.key} has urldate "${urldate}". Use YYYY-MM-DD.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
			continue;
		}

		if (isFutureDate(urldate)) {
			issues.push(
				issue(
					'bibliography-urldate-in-future',
					`cited electronic resource @${entry.key} has future urldate "${urldate}".`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}
	}
}

function validateRequiredBibFields(
	bibPath: string,
	citationKeys: readonly string[],
	entries: readonly BibEntrySource[],
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	for (const entry of entries) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const requiredGroups =
			STO_RULES.bibliography.requiredFieldsByType[entry.entryType];
		if (!requiredGroups) {
			issues.push(
				issue(
					'bibliography-unsupported-type',
					`cited @${entry.key} uses unsupported BibTeX type "${entry.entryType}". Choose a supported bibliography type.`,
					path.basename(bibPath),
					entry.line,
				),
			);
			continue;
		}

		for (const tagNames of requiredGroups) {
			// A generic misc record may describe a print work; URL is conditional.
			if (
				entry.entryType === 'misc' &&
				tagNames.length === 1 &&
				tagNames[0] === 'url' &&
				!isOnlineEntry(entry)
			) {
				continue;
			}
			// Title-first books may credit a compiler or editor in the
			// responsibility statement instead of naming an author.
			if (
				entry.entryType === 'book' &&
				tagNames.includes('author') &&
				tagNames.includes('editor') &&
				/^(?:сост\.|под ред\.|ред\.)\s+\S/i.test(
					getNormalizedTagValue(entry, 'note') ?? '',
				)
			) {
				continue;
			}
			if (
				tagNames.some(tagName =>
					Boolean(getNormalizedTagValue(entry, tagName)),
				)
			) {
				continue;
			}
			issues.push(
				issue(
					'bibliography-required-field-missing',
					`cited @${entry.key} (${entry.entryType}) should define ${formatRequiredFieldGroup(tagNames)} for STO bibliography formatting.`,
					path.basename(bibPath),
					entry.line,
					(tagNames.length === 1 && tagNames[0] === 'title') ||
						(tagNames.length === 1 &&
							tagNames[0] === 'url' &&
							requiresNetworkUrl(entry))
						? 'error'
						: 'warning',
				),
			);
		}
	}
}

function validateBibEntryQuality(
	bibPath: string,
	citationKeys: readonly string[],
	entries: readonly BibEntrySource[],
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	for (const entry of entries) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const doi = getNormalizedTagValue(entry, 'doi');
		if (doi) {
			const lowerDoi = doi.toLowerCase();
			if (
				STO_RULES.bibliography.doiUrlPrefixes.some(prefix =>
					lowerDoi.startsWith(prefix),
				)
			) {
				issues.push(
					issue(
						'bibliography-doi-url',
						`cited @${entry.key} stores a DOI URL in doi. Keep only the DOI value, for example "10.xxxx/xxxxx".`,
						path.basename(bibPath),
						entry.line,
						'warning',
					),
				);
			} else if (!doi.startsWith('10.')) {
				issues.push(
					issue(
						'bibliography-doi-invalid-prefix',
						`cited @${entry.key} has DOI "${doi}". DOI values should start with "10.".`,
						path.basename(bibPath),
						entry.line,
						'warning',
					),
				);
			}
		}

		const pages =
			getNormalizedTagValue(entry, 'pages') ??
			getNormalizedTagValue(entry, 'numpages');
		if (
			entry.entryType === 'book' &&
			pages &&
			/^\d+\s*(?:--|-|–)\s*\d+$/.test(pages)
		) {
			issues.push(
				issue(
					'bibliography-book-pages-range',
					`cited @${entry.key} is a book, but pages looks like a range. Use total page count for books.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}
	}
}

export function hasSourceCitations(files: SourceFile[]): boolean {
	return collectAllCitationKeys(files).length > 0;
}

export function validateBibliography(
	files: SourceFile[],
	sourceDir: string,
	cwd: string,
	config: ReportConfig,
	issues: SourcePreflightIssue[],
): void {
	for (const { file, content } of files) {
		validateManualBibliographyContent(file, content, issues);
	}

	const citationKeys = collectAllCitationKeys(files, issues);
	if (citationKeys.length === 0) {
		return;
	}

	let bibliographyPath: string;
	try {
		bibliographyPath = bibliographyPathFromMetadata(files, sourceDir, cwd);
	} catch (error) {
		issues.push(issue('bibliography-path-ambiguous', String(error)));
		return;
	}
	if (!fs.existsSync(bibliographyPath)) {
		issues.push(
			issue(
				'bibliography-file-missing',
				`citations are present, but bibliography file was not found: ${path.relative(cwd, bibliographyPath)}`,
			),
		);
		return;
	}

	let entries: BibEntrySource[];
	try {
		entries = readBibEntrySources(bibliographyPath);
	} catch (error) {
		issues.push(
			issue(
				'bibliography-parse-error',
				`bibliography file could not be parsed as BibTeX: ${String(error)}`,
				path.basename(bibliographyPath),
			),
		);
		return;
	}
	const bibKeys = new Set(entries.map(entry => entry.key));
	if (bibKeys.size === 0) {
		issues.push(
			issue(
				'bibliography-empty',
				'citations are present, but bibliography file contains no BibTeX entries.',
			),
		);
		return;
	}

	const seenKeys = new Set<string>();
	for (const entry of entries) {
		if (seenKeys.has(entry.key)) {
			issues.push(
				issue(
					'bibliography-duplicate-key',
					`BibTeX key @${entry.key} is defined more than once.`,
					path.basename(bibliographyPath),
					entry.line,
				),
			);
		}
		seenKeys.add(entry.key);
	}

	for (const key of citationKeys) {
		if (!bibKeys.has(key)) {
			issues.push(
				issue(
					'unknown-bibtex-key',
					`citation [@${key}] does not have a matching BibTeX entry.`,
				),
			);
		}
	}
	validateUrlAccessDates(bibliographyPath, citationKeys, entries, issues);
	validateRequiredBibFields(bibliographyPath, citationKeys, entries, issues);
	validateBibEntryQuality(bibliographyPath, citationKeys, entries, issues);

	if (config.document.requireSources === false && citationKeys.length > 0) {
		issues.push(
			issue(
				'sources-disabled-with-citations',
				'report.config.json disables sources, but the source text contains citations.',
			),
		);
	}
}
