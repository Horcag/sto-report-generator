import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LibreOfficePreviewOptions {
	inputDocx: string;
	outputPdf?: string;
	soffice?: string;
}

export function createLibreOfficePreview(
	options: LibreOfficePreviewOptions,
): string {
	const inputDocx = path.resolve(options.inputDocx);
	if (
		!fs.existsSync(inputDocx) ||
		path.extname(inputDocx).toLowerCase() !== '.docx'
	) {
		throw new Error(`Expected an existing DOCX file: ${inputDocx}`);
	}
	const outputPdf = path.resolve(
		options.outputPdf ?? inputDocx.replace(/\.docx$/i, '.preview.pdf'),
	);
	fs.mkdirSync(path.dirname(outputPdf), { recursive: true });
	const temporaryDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-lo-preview-'),
	);
	try {
		const profileUrl = pathToFileURL(
			path.join(temporaryDir, 'profile'),
		).href;
		const result = spawnSync(
			options.soffice ?? 'soffice',
			[
				`-env:UserInstallation=${profileUrl}`,
				'--headless',
				'--convert-to',
				'pdf',
				'--outdir',
				temporaryDir,
				inputDocx,
			],
			{ encoding: 'utf8', shell: false, timeout: 120_000 },
		);
		if (result.error || result.status !== 0) {
			throw new Error(
				`LibreOffice preview failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
			);
		}
		const convertedPdf = path.join(
			temporaryDir,
			`${path.basename(inputDocx, path.extname(inputDocx))}.pdf`,
		);
		if (
			!fs.existsSync(convertedPdf) ||
			fs.statSync(convertedPdf).size < 5
		) {
			throw new Error('LibreOffice did not produce a PDF.');
		}
		const signature = fs
			.readFileSync(convertedPdf)
			.subarray(0, 5)
			.toString('ascii');
		if (signature !== '%PDF-') {
			throw new Error(
				'LibreOffice produced a file without a PDF signature.',
			);
		}
		fs.copyFileSync(convertedPdf, outputPdf);
		return outputPdf;
	} finally {
		fs.rmSync(temporaryDir, { recursive: true, force: true });
	}
}
