import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { unpackDocx } from '@/shared/lib/docx-archive';
import {
	formatSourcePreflightIssue,
	runSourcePreflight,
	SourcePreflightResult,
} from '@/shared/lib/source-preflight';
import { validateSTO, ValidationResult } from '@/shared/lib/sto-validator';

import { buildReport } from './builder';

interface ReportConfig {
	sourceDir?: string;
	outputDocx?: string;
	postBuild?: {
		enabled?: boolean;
		exportPdf?: boolean;
	};
	validate?: {
		enabled?: boolean;
		unpackDir?: string;
	};
}

export interface GenerateReportOptions {
	reportDir: string;
	outputPath?: string;
	postBuild?: boolean;
	validate?: boolean;
}

export interface GenerateReportResult {
	reportDir: string;
	sourceDir: string;
	outputDocx: string;
	preflight: SourcePreflightResult;
	validation?: ValidationResult[];
	postBuildRan: boolean;
}

function readReportConfig(reportDir: string): ReportConfig {
	const configPath = path.join(reportDir, 'report.config.json');
	if (!fs.existsSync(configPath)) {
		return {};
	}
	return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ReportConfig;
}

function resolveInside(baseDir: string, value: string): string {
	return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function formatValidationFailures(results: ValidationResult[]): string {
	return results
		.filter(result => !result.passed)
		.map(result => `${result.check}: ${result.error ?? 'failed'}`)
		.join('\n');
}

function runPostBuild(
	outputDocx: string,
	sourceDir: string,
	exportPdf: boolean,
): void {
	const args = [
		'run',
		'python',
		'scripts/post_build.py',
		outputDocx,
		sourceDir,
	];
	if (!exportPdf) {
		args.push('');
	}

	const result = spawnSync('uv', args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			result.stderr || result.stdout || 'post_build.py failed',
		);
	}
}

export function validateDocxFile(
	docxPath: string,
	unpackDir: string,
): ValidationResult[] {
	unpackDocx(docxPath, unpackDir);
	return validateSTO(unpackDir);
}

export async function generateReport(
	options: GenerateReportOptions,
): Promise<GenerateReportResult> {
	const reportDir = path.resolve(options.reportDir);
	const config = readReportConfig(reportDir);
	const sourceDir = resolveInside(reportDir, config.sourceDir ?? '.');
	const outputDocx = path.resolve(
		reportDir,
		options.outputPath ??
			config.outputDocx ??
			`build/${path.basename(reportDir)}.docx`,
	);

	const preflight = runSourcePreflight(sourceDir);
	if (!preflight.passed) {
		throw new Error(
			preflight.issues.map(formatSourcePreflightIssue).join('\n'),
		);
	}

	await buildReport(sourceDir, outputDocx);

	const shouldRunPostBuild =
		options.postBuild ?? config.postBuild?.enabled ?? false;
	if (shouldRunPostBuild) {
		runPostBuild(
			outputDocx,
			sourceDir,
			config.postBuild?.exportPdf ?? true,
		);
	}

	let validation: ValidationResult[] | undefined;
	const shouldValidate =
		options.validate ?? config.validate?.enabled ?? false;
	if (shouldValidate) {
		const unpackDir = resolveInside(
			reportDir,
			config.validate?.unpackDir ?? '.temp_docx',
		);
		validation = validateDocxFile(outputDocx, unpackDir);
		if (!validation.every(result => result.passed)) {
			throw new Error(formatValidationFailures(validation));
		}
	}

	return {
		reportDir,
		sourceDir,
		outputDocx,
		preflight,
		validation,
		postBuildRan: shouldRunPostBuild,
	};
}
