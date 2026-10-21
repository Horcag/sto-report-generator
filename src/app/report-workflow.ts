import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { insertDocxBodyBeforeText, unpackDocx } from '@/shared/lib/docx';
import {
	ReportRenderer,
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
import { readWordcraftFontDirectory } from './wordcraft-fonts';
import {
	createWordcraftPdf,
	WordcraftRenderResult,
} from './wordcraft-renderer';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

export interface GenerateReportOptions {
	reportDir: string;
	outputPath?: string;
	renderer?: ReportRenderer;
	postBuild?: boolean;
	validate?: boolean;
	outputPdf?: string;
	wordcraftExecutable?: string;
	wordcraftFontDirectory?: string;
	strictFonts?: boolean;
}

export interface GenerateReportResult {
	reportDir: string;
	sourceDir: string;
	outputDocx: string;
	preflight: SourcePreflightResult;
	validation?: ValidationResult[];
	renderer: ReportRenderer;
	postBuildRan: boolean;
	wordcraft?: WordcraftRenderResult;
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
		path.join(PACKAGE_ROOT, 'scripts/post_build.py'),
		outputDocx,
		sourceDir,
	];
	if (!exportPdf) {
		args.push('');
	}

	const result = spawnSync('uv', args, {
		cwd: PACKAGE_ROOT,
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
		renderer: options.renderer,
		postBuild: options.postBuild,
		validate: options.validate,
	});
	if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
		throw new Error(
			diagnostics.map(diagnostic => diagnostic.message).join('\n'),
		);
	}
	if (
		(options.outputPdf ||
			options.wordcraftExecutable ||
			options.wordcraftFontDirectory ||
			options.strictFonts) &&
		config.renderer !== 'wordcraft'
	) {
		throw new Error('PDF overrides require renderer "wordcraft".');
	}
	if (config.renderer !== 'word' && options.postBuild) {
		throw new Error('Word COM post-build requires renderer "word".');
	}

	const sourceDir = resolveReportPath(reportDir, config.sourceDir);
	const outputDocx = path.resolve(reportDir, config.outputDocx);

	const preflight = runSourcePreflight(reportDir, { config });
	if (!preflight.passed) {
		throw new Error(
			preflight.issues.map(formatSourcePreflightIssue).join('\n'),
		);
	}

	await buildReport(sourceDir, outputDocx, {
		stylePreset: config.stylePreset,
	});

	if (config.frontMatterDocx) {
		insertDocxBodyBeforeText({
			targetDocxPath: outputDocx,
			sourceDocxPath: resolveReportPath(
				reportDir,
				config.frontMatterDocx,
			),
			beforeText: 'Реферат',
		});
	}

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
	const wordcraft =
		config.renderer === 'wordcraft'
			? createWordcraftPdf({
					inputDocx: outputDocx,
					outputPdf: options.outputPdf
						? resolveReportPath(reportDir, options.outputPdf)
						: undefined,
					executable: options.wordcraftExecutable,
					fontFiles: readWordcraftFontDirectory(
						options.wordcraftFontDirectory ??
							process.env.WORDCRAFT_FONT_DIR,
					),
					strictFonts: options.strictFonts,
				})
			: undefined;

	return {
		reportDir,
		sourceDir,
		outputDocx,
		preflight,
		validation,
		renderer: config.renderer,
		postBuildRan: config.postBuild.enabled,
		wordcraft,
	};
}
