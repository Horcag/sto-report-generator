import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

import { createWordRenderJob } from '@/app/word-renderer';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-word-publication-'));
mock.method(os, 'release', () => 'microsoft-wsl');
const outputDocx = path.join(root, 'final.docx');
const pdf = path.join(root, 'final.pdf');
const manifest = path.join(root, 'final.acceptance.json');
const options = {
	outputDocx,
	exportPdf: true,
	sourceDir: root,
	stylePreset: 'default' as const,
};
const hash = (value: string) =>
	crypto.createHash('sha256').update(value).digest('hex');
function prepare(job: ReturnType<typeof createWordRenderJob>) {
	const stage = path.dirname(job.inputDocx);
	fs.writeFileSync(job.acceptedDocx, 'verified-docx');
	fs.writeFileSync(path.join(stage, 'accepted.pdf'), '%PDF-verified');
	fs.writeFileSync(
		path.join(stage, 'acceptance.json'),
		JSON.stringify({
			status: 'accepted',
			execution: { processCleanupVerified: true },
			stablePageCount: true,
			pageCountAfterReopen: 3,
			inputDocx: { path: job.inputDocx },
			acceptedDocx: {
				path: job.acceptedDocx,
				sha256: hash('verified-docx'),
			},
			pdf: {
				path: path.join(stage, 'accepted.pdf'),
				sha256: hash('%PDF-verified'),
			},
			postBuild: { pdf_path: 'internal.pdf' },
			capabilityChecks: { exportedPdf: true },
		}),
	);
}
try {
	let job = createWordRenderJob(options);
	assert.ok(!fs.existsSync(outputDocx), 'raw DOCX must not be published');
	assert.throws(() => createWordRenderJob(options), /EEXIST/);
	assert.ok(
		fs.existsSync(`${outputDocx}.word.lock`),
		'foreign lock must survive failed claim',
	);
	prepare(job);
	assert.deepEqual(job.publish(), { manifest, pdf });
	job.close();
	let evidence = JSON.parse(fs.readFileSync(manifest, 'utf8'));
	assert.equal(evidence.acceptedDocx.path, outputDocx);
	assert.equal(
		evidence.acceptedDocx.sha256,
		hash(fs.readFileSync(outputDocx, 'utf8')),
	);
	assert.equal(evidence.pdf.path, pdf);
	assert.equal(evidence.pdf.sha256, hash(fs.readFileSync(pdf, 'utf8')));
	assert.ok(!fs.existsSync(`${outputDocx}.word.lock`));

	fs.writeFileSync(pdf, 'unrelated-stale-pdf');
	job = createWordRenderJob({ ...options, exportPdf: false });
	prepare(job);
	job.publish();
	job.close();
	assert.equal(fs.readFileSync(pdf, 'utf8'), 'unrelated-stale-pdf');
	evidence = JSON.parse(fs.readFileSync(manifest, 'utf8'));
	assert.equal(evidence.pdf, null);
	assert.equal(evidence.capabilityChecks.exportedPdf, false);
	assert.equal(evidence.internalPdfVerified, true);

	const previous = new Map(
		[outputDocx, pdf, manifest].map(file => [file, fs.readFileSync(file)]),
	);
	job = createWordRenderJob(options);
	prepare(job);
	const rename = fs.renameSync;
	const failure = mock.method(
		fs,
		'renameSync',
		(source: fs.PathLike, target: fs.PathLike) => {
			if (String(source).endsWith('accepted.pdf') && target === pdf)
				throw new Error('injected publication failure');
			return rename(source, target);
		},
	);
	assert.throws(() => job.publish(), /injected publication failure/);
	failure.mock.restore();
	job.close();
	for (const [file, bytes] of previous)
		assert.deepEqual(fs.readFileSync(file), bytes);
	assert.throws(
		() =>
			createWordRenderJob({
				...options,
				outputPdf: outputDocx.toUpperCase(),
			}),
		/must be distinct/,
	);
	const customPdf = path.join(root, 'preview', 'custom.pdf');
	job = createWordRenderJob({ ...options, outputPdf: customPdf });
	prepare(job);
	assert.equal(job.publish().pdf, customPdf);
	job.close();
	assert.equal(fs.readFileSync(customPdf, 'utf8'), '%PDF-verified');
	const stat = fs.statSync;
	const otherVolume = mock.method(fs, 'statSync', (file: fs.PathLike) => {
		const value = stat(file);
		if (String(file) === path.dirname(customPdf))
			return { ...value, dev: value.dev + 1 };
		return value;
	});
	assert.throws(
		() => createWordRenderJob({ ...options, outputPdf: customPdf }),
		/same filesystem/,
	);
	otherVolume.mock.restore();
	assert.equal(fs.readFileSync(customPdf, 'utf8'), '%PDF-verified');
	const directoryTarget = path.join(root, 'directory.docx');
	fs.mkdirSync(directoryTarget);
	assert.throws(
		() => createWordRenderJob({ ...options, outputDocx: directoryTarget }),
		/regular files/,
	);
	assert.ok(fs.statSync(directoryTarget).isDirectory());
	assert.ok(
		fs
			.readdirSync(root)
			.every(
				file =>
					!file.startsWith('.sto-word-') &&
					!file.endsWith('.word.lock'),
			),
	);
	console.log(
		'Word renderer publication tests passed: raw staging, destination locks, exact paths/hashes, optional PDF, rollback, case-insensitive collisions.',
	);
} finally {
	mock.restoreAll();
	fs.rmSync(root, { recursive: true, force: true });
}
