import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { WordAcceptancePlan } from './word-acceptance';

/** Word's image-quality flag is a request; verify and preserve actual PDF pixels. */
export function preserveWordPdfImages(
	plan: WordAcceptancePlan,
	manifest: { pdf: { sha256: string; export: Record<string, unknown> } },
): void {
	if (plan.request.pdfImageQuality !== 'original') return;
	const temporaryDirectory = path.dirname(plan.requestJsonPath);
	const output = path.join(temporaryDirectory, 'original-images.pdf');
	const receipt = path.join(temporaryDirectory, 'pdf-images.json');
	const result = spawnSync(
		'uv',
		[
			'run',
			'--with',
			'pymupdf==2.0',
			'python',
			path.resolve(
				__dirname,
				'../../scripts/quality/preserve_pdf_images.py',
			),
			plan.localAcceptedDocx,
			plan.localPdf,
			'--output',
			output,
			'--receipt',
			receipt,
		],
		{
			cwd: path.resolve(__dirname, '../..'),
			encoding: 'utf8',
			timeout: 120_000,
			shell: false,
		},
	);
	if (result.error || result.status !== 0)
		throw new Error(
			`PDF original image preservation failed: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`,
		);
	const evidence = JSON.parse(fs.readFileSync(receipt, 'utf8'));
	if (evidence.status !== 'originalPixelsVerified')
		throw new Error(
			'PDF image restoration did not verify original pixels.',
		);
	const publication = fs.mkdtempSync(
		path.join(path.dirname(plan.localPdf), '.sto-pdf-images-'),
	);
	try {
		const staged = path.join(publication, 'verified.pdf');
		fs.copyFileSync(output, staged);
		fs.renameSync(staged, plan.localPdf);
	} finally {
		fs.rmSync(publication, { recursive: true, force: true });
	}
	manifest.pdf.sha256 = evidence.pdf_sha256;
	manifest.pdf.export.qualityStatus = evidence.status;
	manifest.pdf.export.imagePreservation = evidence;
	console.log(result.stdout.trim());
}
