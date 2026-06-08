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

	if (config.document.requireSources === false && citationKeys.length > 0) {
		issues.push(
			issue(
				'sources-disabled-with-citations',
				'report.config.json disables sources, but the source text contains citations.',
			),
		);
	}
}
