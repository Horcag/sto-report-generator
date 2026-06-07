import fs from 'node:fs';
import path from 'node:path';

import {
	ReportConfigDiagnostic,
	resolveReportConfig,
	resolveReportPath,
} from './report-config';
import { validateImageExists } from './source-preflight/asset-checker';
import { validateBibliography } from './source-preflight/bibliography-checker';
import { validateStoEnvironments } from './source-preflight/environment-checker';
import { validateSourceFormulas } from './source-preflight/formula-checker';
import { validateMarkdownHeadings } from './source-preflight/heading-checker';
import { validateLists } from './source-preflight/list-checker';
import { validateMetadata } from './source-preflight/metadata-checker';
import { validateMicrotypography } from './source-preflight/microtypography-checker';
import { validateSourcePunctuation } from './source-preflight/punctuation-checker';
import { validateReferat } from './source-preflight/referat-checker';
import {
	collectLabelDefinitions,
	validateUnknownReferences,
} from './source-preflight/reference-checker';
import { validateSoftTextRules } from './source-preflight/soft-text-checker';
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

function issueFromConfigDiagnostic(
	diagnostic: ReportConfigDiagnostic,
): SourcePreflightIssue {
	return {
		code: diagnostic.code,
		file: diagnostic.file ? path.basename(diagnostic.file) : undefined,
		message: diagnostic.message,
		severity: diagnostic.severity,
	};
}

export function runSourcePreflight(
	reportDir: string,
	options: SourcePreflightOptions = {},
): SourcePreflightResult {
	const cwd = options.cwd ?? process.cwd();
	const absoluteReportDir = path.resolve(cwd, reportDir);
	const resolved = options.config
		? { config: options.config, diagnostics: [] }
		: resolveReportConfig(absoluteReportDir, {
				cwd,
				strict: options.strict,
			});
	const config = resolved.config;
	const strict = options.strict ?? config.preflight.strict;
	const absoluteSourceDir = resolveReportPath(
		absoluteReportDir,
		config.sourceDir,
	);
	const issues: SourcePreflightIssue[] = [];
	issues.push(...resolved.diagnostics.map(issueFromConfigDiagnostic));

	if (!fs.existsSync(absoluteReportDir)) {
		issues.push({
			code: 'report-dir-not-found',
			message: `Directory not found: ${reportDir}`,
			severity: 'error',
		});
		return {
			config,
			issues,
			passed: false,
			reportDir: absoluteReportDir,
			sourceDir: absoluteSourceDir,
		};
	}

	if (!fs.existsSync(absoluteSourceDir)) {
		issues.push({
			code: 'source-dir-not-found',
			message: `Source directory not found: ${config.sourceDir}`,
			severity: 'error',
		});
		return {
			config,
			issues,
			passed: false,
			reportDir: absoluteReportDir,
			sourceDir: absoluteSourceDir,
		};
	}

	const files = readSourceFiles(absoluteSourceDir);
	if (files.length === 0) {
		issues.push({
			code: 'no-markdown-files',
			message: 'No Markdown files found.',
			severity: 'error',
		});
		return {
			config,
			issues,
			passed: false,
			reportDir: absoluteReportDir,
			sourceDir: absoluteSourceDir,
		};
	}

	const definitions: LabelDefinitions = new Map();

	for (const { file, content } of files) {
		validateStoEnvironments(file, content, issues);
		validateSourcePunctuation(file, content, issues);
		validateMarkdownHeadings(file, content, issues);
		collectLabelDefinitions(file, content, definitions, issues);
	}

	for (const { file, content } of files) {
		validateMicrotypography(file, content, issues);
		validateSoftTextRules(file, content, config, issues);
		validateLists(file, content, issues);
		validateSourceFormulas(file, content, issues);
		validateMarkdownTables(file, content, issues);
		validateImageExists(file, content, absoluteSourceDir, cwd, issues);
		validateUnknownReferences(file, content, definitions, issues);
	}

	validateMetadata(files, issues);
	validateBibliography(files, absoluteSourceDir, cwd, config, issues);
	validateReferat(files, issues, config);
	validateDocumentStructure(files, issues, config);
	validateTableAndFigureOrder(files, issues);

	return {
		config,
		reportDir: absoluteReportDir,
		sourceDir: absoluteSourceDir,
		issues,
		passed: !hasBlockingIssues(issues, strict),
	};
}
