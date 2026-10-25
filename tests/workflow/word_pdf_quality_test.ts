import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

import { createWordAcceptancePlan } from '@/app/word-acceptance';
import { preserveWordPdfImages } from '@/app/word-pdf-quality';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-pdf-quality-test-'));
try {
	const options = {
		inputDocx: path.join(root, 'input.docx'),
		pdf: path.join(root, 'output.pdf'),
	};
	const environment = {
		hostKind: 'wsl' as const,
		toHostPath: (p: string) => p,
		requestJsonPath: path.join(root, 'request.json'),
	};
	const plan = createWordAcceptancePlan(options, environment);
	assert.equal(plan.request.pdfImageQuality, 'original');
	assert.throws(
		() =>
			createWordAcceptancePlan(
				{ ...options, pdfImageQuality: 'typo' },
				environment,
			),
		/PDF image quality/,
	);
	const manifest = {
		pdf: { sha256: 'old', export: {} as Record<string, unknown> },
	};
	fs.writeFileSync(plan.localPdf, 'old PDF');
	let calls = 0;
	let fail = false;
	mock.method(
		childProcess,
		'spawnSync',
		(
			command: string,
			args: string[],
			settings: { timeout: number; shell: boolean },
		) => {
			calls++;
			assert.equal(command, 'uv');
			assert.deepEqual(args.slice(0, 4), [
				'run',
				'--with',
				'pymupdf==2.0',
				'python',
			]);
			assert.equal(settings.timeout, 120_000);
			assert.equal(settings.shell, false);
			if (fail)
				return { status: 1, stdout: '', stderr: 'identity uncertain' };
			fs.writeFileSync(
				args[args.indexOf('--output') + 1],
				'verified PDF',
			);
			fs.writeFileSync(
				args[args.indexOf('--receipt') + 1],
				JSON.stringify({
					pdf_sha256: 'new',
					status: 'originalPixelsVerified',
				}),
			);
			return { status: 0, stdout: 'verified', stderr: '' };
		},
	);
	for (const quality of ['print', 'screen']) {
		const reduced = createWordAcceptancePlan(
			{ ...options, pdfImageQuality: quality },
			environment,
		);
		assert.equal(reduced.request.pdfImageQuality, quality);
		preserveWordPdfImages(reduced, manifest);
	}
	assert.equal(calls, 0);
	preserveWordPdfImages(plan, manifest);
	assert.equal(calls, 1);
	assert.equal(fs.readFileSync(plan.localPdf, 'utf8'), 'verified PDF');
	assert.equal(manifest.pdf.sha256, 'new');
	assert.equal(manifest.pdf.export.qualityStatus, 'originalPixelsVerified');
	fail = true;
	assert.throws(
		() => preserveWordPdfImages(plan, manifest),
		/identity uncertain/,
	);
	assert.equal(fs.readFileSync(plan.localPdf, 'utf8'), 'verified PDF');
	console.log(
		'PDF quality: default, invalid option, print/screen bypass, verified replacement and failed preservation passed.',
	);
} finally {
	mock.restoreAll();
	fs.rmSync(root, { recursive: true, force: true });
}
