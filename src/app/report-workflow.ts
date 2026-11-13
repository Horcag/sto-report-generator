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
import { createWordRenderJob, WordRenderResult } from './word-renderer';
import { readWordcraftFontDirectory } from './wordcraft-fonts';
import {
	createWordcraftPdf,
	WordcraftRenderResult,
} from './wordcraft-renderer';

export interface GenerateReportOptions {
	pdfImageQuality?: string;
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
	word?: WordRenderResult;
}

function formatValidationFailures(results: ValidationResult[]): string {
	return results
		.filter(result => !result.passed)
		.map(result => `${result.check}: ${result.error ?? 'failed'}`)
		.join('\n');
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
		pdfImageQuality: options.pdfImageQuality,
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
		(options.wordcraftExecutable ||
			options.wordcraftFontDirectory ||
			options.strictFonts) &&
		config.renderer !== 'wordcraft'
	) {
		throw new Error('Wordcraft overrides require renderer "wordcraft".');
	}
	if (
		options.outputPdf &&
		(config.renderer === 'portable' ||
			(config.renderer === 'word' && !config.postBuild.exportPdf))
	) {
		throw new Error(
			'PDF override requires a PDF-enabled word or wordcraft renderer.',
		);
	}
	if (
		config.renderer !== 'word' &&
		(options.pdfImageQuality || config.postBuild.pdfImageQuality)
	) {
		throw new Error('--pdf-image-quality requires renderer word.');
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

	const wordJob =
		config.renderer === 'word'
			? createWordRenderJob({
					outputDocx,
					outputPdf: options.outputPdf
						? resolveReportPath(reportDir, options.outputPdf)
						: undefined,
					exportPdf: config.postBuild.exportPdf,
					pdfImageQuality: config.postBuild.pdfImageQuality,
					sourceDir,
					stylePreset: config.stylePreset,
				})
			: undefined;
	try {
		const buildDocx = wordJob?.inputDocx ?? outputDocx;
		await buildReport(sourceDir, buildDocx, {
			stylePreset: config.stylePreset,
		});

		if (config.frontMatterDocx) {
			insertDocxBodyBeforeText({
				targetDocxPath: buildDocx,
				sourceDocxPath: resolveReportPath(
					reportDir,
					config.frontMatterDocx,
				),
				beforeText: 'Реферат',
			});
		}

		if (config.postBuild.enabled) {
			wordJob!.render();
		}

		let validation: ValidationResult[] | undefined;
		if (config.validate.enabled) {
			const unpackDir = resolveReportPath(
				reportDir,
				config.validate.unpackDir,
			);
			validation = validateDocxFile(
				wordJob?.acceptedDocx ?? outputDocx,
				unpackDir,
			);
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
			word: wordJob?.publish(),
		};
	} finally {
		wordJob?.close();
	}
}
