import fs from 'node:fs';
import path from 'node:path';

import { validateImageExists } from './source-preflight/asset-checker';
import { validateStoEnvironments } from './source-preflight/environment-checker';
import { validateSourceFormulas } from './source-preflight/formula-checker';
import { validateLists } from './source-preflight/list-checker';
import { validateMicrotypography } from './source-preflight/microtypography-checker';
import { validateSourcePunctuation } from './source-preflight/punctuation-checker';
import { validateReferat } from './source-preflight/referat-checker';
import {
	collectLabelDefinitions,
	validateUnknownReferences,
} from './source-preflight/reference-checker';
import { validateDocumentStructure } from './source-preflight/structure-checker';
import {
	validateMarkdownTables,
	validateTableAndFigureOrder,
} from './source-preflight/table-figure-checker';
import {
	LabelDefinitions,
	SourceFile,
	SourcePreflightIssue,
	SourcePreflightOptions,
	SourcePreflightResult,
} from './source-preflight/types';

export type {
	SourcePreflightIssue,
	SourcePreflightOptions,
	SourcePreflightResult,
	SourcePreflightSeverity,
} from './source-preflight/types';

export function formatSourcePreflightIssue(item: SourcePreflightIssue): string {
	const location = item.file
		? item.line
			? `[${item.file}:L${item.line}]`
			: `[${item.file}]`
		: '[project]';
	const prefix = item.severity === 'warning' ? 'WARN' : 'FAIL';
	return `${prefix}: ${location} ${item.message}`;
}

function readSourceFiles(absoluteReportDir: string): SourceFile[] {
	const mdFiles = fs
		.readdirSync(absoluteReportDir)
		.filter(
			file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
		)
		.sort((left, right) => left.localeCompare(right));

	return mdFiles.map(file => ({
		file,
		content: fs.readFileSync(path.join(absoluteReportDir, file), 'utf8'),
	}));
}

function hasBlockingIssues(
	issues: readonly SourcePreflightIssue[],
	strict: boolean,
): boolean {
	return issues.some(
		item =>
			item.severity === 'error' ||
			(strict && item.severity === 'warning'),
	);
}

export function runSourcePreflight(
	reportDir: string,
	options: SourcePreflightOptions = {},
): SourcePreflightResult {
	const cwd = options.cwd ?? process.cwd();
	const strict = options.strict ?? false;
	const absoluteReportDir = path.resolve(cwd, reportDir);
	const issues: SourcePreflightIssue[] = [];

	if (!fs.existsSync(absoluteReportDir)) {
		issues.push({
			code: 'report-dir-not-found',
			message: `Directory not found: ${reportDir}`,
			severity: 'error',
		});
		return { reportDir: absoluteReportDir, issues, passed: false };
	}

	const files = readSourceFiles(absoluteReportDir);
	if (files.length === 0) {
		issues.push({
			code: 'no-markdown-files',
			message: 'No Markdown files found.',
			severity: 'error',
		});
		return { reportDir: absoluteReportDir, issues, passed: false };
	}

	const definitions: LabelDefinitions = new Map();

	for (const { file, content } of files) {
		validateStoEnvironments(file, content, issues);
		validateSourcePunctuation(file, content, issues);
		collectLabelDefinitions(file, content, definitions, issues);
	}

	for (const { file, content } of files) {
		validateMicrotypography(file, content, issues);
		validateLists(file, content, issues);
		validateSourceFormulas(file, content, issues);
		validateMarkdownTables(file, content, issues);
		validateImageExists(file, content, absoluteReportDir, cwd, issues);
		validateUnknownReferences(file, content, definitions, issues);
	}

	validateReferat(files, issues);
	validateDocumentStructure(files, issues);
	validateTableAndFigureOrder(files, issues);

	return {
		reportDir: absoluteReportDir,
		issues,
		passed: !hasBlockingIssues(issues, strict),
	};
}
