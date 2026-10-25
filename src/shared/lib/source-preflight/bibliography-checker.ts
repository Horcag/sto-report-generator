import fs from 'node:fs';
import path from 'node:path';

import { STO_RULES } from '@/shared/config';
import { ReportConfig } from '@/shared/lib/report-config';

import { validateCitationContext } from './bibliography-citations';
import { validateManualBibliographyContent } from './bibliography-content-checker';
import {
	bibliographyPathFromMetadata,
	collectAllCitationKeys,
	readBibliographyMetadata,
} from './bibliography-context';
import { isFutureDate, parseIsoDate } from './bibliography-date';
import { validateBibliographyEvidence } from './bibliography-evidence';
import { validateBibliographyMetadata } from './bibliography-metadata';
import {
	BibEntrySource,
	getNormalizedTagValue,
	hasAnyBibTag,
	readBibEntrySources,
	readBibTagValue,
} from './bibtex-source';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue } from './utils';

const ONLINE_ENTRY_TYPES = new Set(['online', 'inonline']);
const ONLINE_SUBTYPES = new Set(['online', 'electronic']);

function formatRequiredFieldGroup(tagNames: readonly string[]): string {
	return tagNames.join(' or ');
}

function parseOmissionReasons(raw: string): Map<string, string> {
	const reasons = new Map<string, string>();
	for (const part of raw.split(';')) {
		const separator = part.indexOf(':');
		if (separator < 0) continue;
		const field = part.slice(0, separator).trim().toLowerCase();
		const reason = part.slice(separator + 1).trim();
		if (field && reason.length >= 10 && !reasons.has(field)) {
			reasons.set(field, reason);
		}
	}
	return reasons;
}

function isStructuralBibliographyField(
	entry: BibEntrySource,
	tagNames: readonly string[],
): boolean {
	const group = tagNames.join('|');
	return (
		group === 'title' ||
		(tagNames.includes('author') &&
			[
				'book',
				'article',
				'inproceedings',
				'incollection',
				'thesis',
				'phdthesis',
				'mastersthesis',
				'report',
				'techreport',
				'patent',
			].includes(entry.entryType)) ||
		(entry.entryType === 'book' && ['publisher', 'year'].includes(group)) ||
		(group === 'year' &&
			!['misc', 'online', 'inonline'].includes(entry.entryType)) ||
		(entry.entryType === 'patent' && group === 'year|date') ||
		(group === 'url' && requiresNetworkUrl(entry)) ||
		(entry.entryType === 'article' && group === 'journal') ||
		(['inproceedings', 'incollection'].includes(entry.entryType) &&
			group === 'booktitle') ||
		(entry.entryType === 'inonline' && group === 'website|booktitle') ||
		(['patent', 'standard'].includes(entry.entryType) && group === 'number')
	);
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
		const omissionReasons = parseOmissionReasons(
			getNormalizedTagValue(entry, 'omissionreasons') ?? '',
		);

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
				tagNames.includes('compiler') &&
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
			// An anonymous or unattributed source is valid when the absence
			// is checked against the source and explained explicitly.
			if (
				tagNames.includes('author') &&
				(getNormalizedTagValue(entry, 'responsibilityabsence')
					?.length ?? 0) >= 10
			) {
				continue;
			}
			const structural = isStructuralBibliographyField(entry, tagNames);
			const explained = !structural && omissionReasons.has(tagNames[0]);
			if (explained) continue;
			const guidance = tagNames.includes('author')
				? ' If the source is anonymous, explain the checked absence in responsibilityabsence (at least 10 characters).'
				: structural
					? ' This field is mandatory for this source type.'
					: ` If absent or inapplicable, record a source-based explanation as omissionreasons = {${tagNames[0]}: reason of at least 10 characters}.`;
			issues.push(
				issue(
					'bibliography-required-field-missing',
					`cited @${entry.key} (${entry.entryType}) should define ${formatRequiredFieldGroup(tagNames)} for STO bibliography formatting.${guidance}`,
					path.basename(bibPath),
					entry.line,
					'error',
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
	requireEvidence = false,
): void {
	for (const { file, content } of files) {
		validateManualBibliographyContent(file, content, issues);
	}
	validateCitationContext(files, issues);

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
	const citedEntries = entries.filter(entry =>
		citationKeys.includes(entry.key),
	);
	validateBibliographyMetadata(bibliographyPath, citedEntries, issues);
	validateBibliographyEvidence(
		bibliographyPath,
		citedEntries,
		issues,
		requireEvidence ||
			readBibliographyMetadata(files).bibliographyEvidence === 'required',
	);

	if (config.document.requireSources === false && citationKeys.length > 0) {
		issues.push(
			issue(
				'sources-disabled-with-citations',
				'report.config.json disables sources, but the source text contains citations.',
			),
		);
	}
}
