import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

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

	if (config.document.requireSources === false && citationKeys.length > 0) {
		issues.push(
			issue(
				'sources-disabled-with-citations',
				'report.config.json disables sources, but the source text contains citations.',
			),
		);
	}
}
