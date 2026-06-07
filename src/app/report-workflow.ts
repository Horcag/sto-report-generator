import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { unpackDocx } from '@/shared/lib/docx-archive';
import {
	resolveReportConfig,
	resolveReportPath,
} from '@/shared/lib/report-config';
import {
	formatSourcePreflightIssue,
	runSourcePreflight,
	SourcePreflightResult,
} from '@/shared/lib/source-preflight';
import { validateSTO, ValidationResult } from '@/shared/lib/sto-validator';

import { buildReport } from './builder';

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
	const { config, diagnostics } = resolveReportConfig(reportDir, {
		outputPath: options.outputPath,
		postBuild: options.postBuild,
		validate: options.validate,
	});
	if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
		throw new Error(
			diagnostics.map(diagnostic => diagnostic.message).join('\n'),
		);
	}

	const sourceDir = resolveReportPath(reportDir, config.sourceDir);
	const outputDocx = path.resolve(reportDir, config.outputDocx);

	const preflight = runSourcePreflight(reportDir, { config });
	if (!preflight.passed) {
		throw new Error(
			preflight.issues.map(formatSourcePreflightIssue).join('\n'),
		);
	}

	await buildReport(sourceDir, outputDocx);

	if (config.postBuild.enabled) {
		runPostBuild(outputDocx, sourceDir, config.postBuild.exportPdf);
	}

	let validation: ValidationResult[] | undefined;
	if (config.validate.enabled) {
		const unpackDir = resolveReportPath(
			reportDir,
			config.validate.unpackDir,
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
		postBuildRan: config.postBuild.enabled,
	};
}
