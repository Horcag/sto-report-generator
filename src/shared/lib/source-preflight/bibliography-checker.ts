import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

import { STO_RULES } from '@/shared/config';
import { ReportConfig } from '@/shared/lib/report-config';

import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

function collectCitationKeys(content: string): string[] {
	const keys = new Set<string>();
	for (const match of content.matchAll(/\[@([^\]]+)]/g)) {
		for (const key of match[1].split(/[;,]/)) {
			const normalized = key.trim().replace(/^@/, '');
			if (normalized) {
				keys.add(normalized);
			}
		}
	}
	return [...keys];
}

function collectAllCitationKeys(files: SourceFile[]): string[] {
	return [
		...new Set(
			files.flatMap(({ content }) => collectCitationKeys(content)),
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

function resolveBibliographyPath(
	files: SourceFile[],
	sourceDir: string,
	cwd: string,
): string {
	const metadata = readMetadata(files);
	const rawPath =
		typeof metadata.bibliography === 'string'
			? metadata.bibliography
			: 'references.bib';
	const cwdRelative = path.resolve(cwd, rawPath);
	if (fs.existsSync(cwdRelative)) {
		return cwdRelative;
	}
	return path.resolve(sourceDir, rawPath);
}

function readBibKeys(bibPath: string): Set<string> {
	const content = fs.readFileSync(bibPath, 'utf8');
	return new Set(
		[...content.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map(match =>
			match[1].trim(),
		),
	);
}

interface BibEntrySource {
	entryType: string;
	key: string;
	raw: string;
	line: number;
}

function readBibEntrySources(bibPath: string): BibEntrySource[] {
	const content = fs.readFileSync(bibPath, 'utf8');
	return [
		...content.matchAll(
			/@(\w+)\s*\{\s*([^,\s]+)\s*,[\s\S]*?(?=\n@\w+\s*\{|\s*$)/g,
		),
	].map(match => ({
		entryType: match[1].trim().toLowerCase(),
		key: match[2].trim(),
		line: lineNumberAt(content, match.index ?? 0),
		raw: match[0],
	}));
}

function hasBibTag(rawEntry: string, tagName: string): boolean {
	return new RegExp(String.raw`^\s*${tagName}\s*=`, 'im').test(rawEntry);
}

function readBibTagValue(
	rawEntry: string,
	tagName: string,
): string | undefined {
	const match = new RegExp(
		String.raw`^\s*${tagName}\s*=\s*(?:\{([^}\r\n]+)\}|"([^"\r\n]+)")`,
		'im',
	).exec(rawEntry);
	return match?.[1]?.trim() ?? match?.[2]?.trim();
}

function hasAnyBibTag(rawEntry: string, tagNames: readonly string[]): boolean {
	return tagNames.some(tagName => hasBibTag(rawEntry, tagName));
}

function formatRequiredFieldGroup(tagNames: readonly string[]): string {
	return tagNames.join(' or ');
}

function parseIsoDate(value: string): Date | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		return undefined;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		return undefined;
	}
	return parsed;
}

function isFutureDate(value: string): boolean {
	const parsed = parseIsoDate(value);
	if (!parsed) {
		return false;
	}
	const now = new Date();
	const today = new Date(
		Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
	);
	return parsed.getTime() > today.getTime();
}

function isMostlyLatinText(value: string): boolean {
	const latinCount = [...value.matchAll(/[A-Za-z]/g)].length;
	const cyrillicCount = [...value.matchAll(/[А-Яа-яЁё]/g)].length;
	return latinCount >= 5 && latinCount > cyrillicCount * 2;
}

function getNormalizedTagValue(
	rawEntry: string,
	tagName: string,
): string | undefined {
	return readBibTagValue(rawEntry, tagName)?.replace(/[{}]/g, '').trim();
}

function hasLatinLanguageMetadata(rawEntry: string): boolean {
	const langid = getNormalizedTagValue(rawEntry, 'langid')?.toLowerCase();
	const language = getNormalizedTagValue(rawEntry, 'language')?.toLowerCase();
	return [langid, language].some(
		value =>
			value !== undefined &&
			STO_RULES.bibliography.latinLangidValues.includes(value),
	);
}

function validateUrlAccessDates(
	bibPath: string,
	citationKeys: readonly string[],
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	const urldatePattern = new RegExp(STO_RULES.bibliography.urldatePattern);
	for (const entry of readBibEntrySources(bibPath)) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const url = readBibTagValue(entry.raw, 'url');
		if (!url) {
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

		const urldate = readBibTagValue(entry.raw, 'urldate');
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

		if (!urldatePattern.test(urldate)) {
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
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	for (const entry of readBibEntrySources(bibPath)) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const requiredGroups =
			STO_RULES.bibliography.requiredFieldsByType[entry.entryType];
		if (!requiredGroups) {
			continue;
		}

		for (const tagNames of requiredGroups) {
			if (hasAnyBibTag(entry.raw, tagNames)) {
				continue;
			}
			issues.push(
				issue(
					'bibliography-required-field-missing',
					`cited @${entry.key} (${entry.entryType}) should define ${formatRequiredFieldGroup(tagNames)} for STO bibliography formatting.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}
	}
}

function validateBibEntryQuality(
	bibPath: string,
	citationKeys: readonly string[],
	issues: SourcePreflightIssue[],
): void {
	const citedKeys = new Set(citationKeys);
	for (const entry of readBibEntrySources(bibPath)) {
		if (!citedKeys.has(entry.key)) {
			continue;
		}

		const doi = getNormalizedTagValue(entry.raw, 'doi');
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

		const title = getNormalizedTagValue(entry.raw, 'title') ?? '';
		const author = getNormalizedTagValue(entry.raw, 'author') ?? '';
		const journal = getNormalizedTagValue(entry.raw, 'journal') ?? '';
		const searchableJournal = journal.toLowerCase();
		if (
			entry.entryType === 'article' &&
			STO_RULES.bibliography.articlePreprintJournalPatterns.some(
				pattern => searchableJournal.includes(pattern),
			)
		) {
			issues.push(
				issue(
					'bibliography-article-preprint-type',
					`cited @${entry.key} is an article, but journal looks like a working paper/preprint series. Use techreport or misc/online if it is not a journal article.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}

		if (
			!hasLatinLanguageMetadata(entry.raw) &&
			isMostlyLatinText(`${author} ${title} ${journal}`)
		) {
			issues.push(
				issue(
					'bibliography-latin-entry-missing-langid',
					`cited @${entry.key} looks like a Latin-script source. Add langid = {english} when the source is in English.`,
					path.basename(bibPath),
					entry.line,
					'warning',
				),
			);
		}

		const pages =
			getNormalizedTagValue(entry.raw, 'pages') ??
			getNormalizedTagValue(entry.raw, 'numpages');
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

function validateManualBibliographyContent(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(
		/\\begin\{sto_bibliography\}\s*([\s\S]*?)\s*\\end\{sto_bibliography\}/g,
	)) {
		const manualContent = match[1].trim();
		if (manualContent.length > 0) {
			issues.push(
				issue(
					'manual-bibliography-content',
					'sto_bibliography must stay empty. The generator inserts only cited sources automatically.',
					file,
					lineNumberAt(content, match.index ?? 0),
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

	const citationKeys = collectAllCitationKeys(files);
	if (citationKeys.length === 0) {
		return;
	}

	const bibliographyPath = resolveBibliographyPath(files, sourceDir, cwd);
	if (!fs.existsSync(bibliographyPath)) {
		issues.push(
			issue(
				'bibliography-file-missing',
				`citations are present, but bibliography file was not found: ${path.relative(cwd, bibliographyPath)}`,
			),
		);
		return;
	}

	const bibKeys = readBibKeys(bibliographyPath);
	if (bibKeys.size === 0) {
		issues.push(
			issue(
				'bibliography-empty',
				'citations are present, but bibliography file contains no BibTeX entries.',
			),
		);
		return;
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
	validateUrlAccessDates(bibliographyPath, citationKeys, issues);
	validateRequiredBibFields(bibliographyPath, citationKeys, issues);
	validateBibEntryQuality(bibliographyPath, citationKeys, issues);

	if (config.document.requireSources === false && citationKeys.length > 0) {
		issues.push(
			issue(
				'sources-disabled-with-citations',
				'report.config.json disables sources, but the source text contains citations.',
			),
		);
	}
}
