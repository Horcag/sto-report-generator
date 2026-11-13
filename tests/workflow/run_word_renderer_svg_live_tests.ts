import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { scaffoldReport } from '@/app/report-scaffold';

const scratch = process.env.AGENT_STORAGE_SCRATCH;
if (!scratch)
	throw new Error('Live Word SVG tests require AGENT_STORAGE_SCRATCH.');
const tsx = require.resolve('tsx/cli');
for (const noPdf of [false, true]) {
	const report = path.join(scratch, noPdf ? 'svg-no-pdf' : 'svg-print');
	scaffoldReport({
		slug: 'synthetic-svg',
		dir: report,
		profile: 'lab',
		initGit: false,
	});
	const configPath = path.join(report, 'report.config.json');
	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	config.renderer = 'word';
	config.postBuild = {
		enabled: true,
		exportPdf: !noPdf,
		pdfImageQuality: noPdf ? 'print' : 'original',
	};
	fs.writeFileSync(configPath, JSON.stringify(config));
	fs.copyFileSync(
		'example/images/dummy.svg',
		path.join(report, 'images/technical.svg'),
	);
	fs.copyFileSync(
		'example/images/dummy.png',
		path.join(report, 'images/technical.png'),
	);

	const resultsPath = path.join(report, '30_results.md');
	fs.appendFileSync(
		resultsPath,
		'\n\nСинтетическая схема показана на рисунке 1.\n\n![Синтетическая схема](images/technical.svg)\n\nРисунок 1 – Синтетическая схема (@fig:synthetic)\n',
	);
	const before = fs.readFileSync(resultsPath);
	const output = path.resolve(report, config.outputDocx);
	const pdf = output.replace(/\.docx$/, '.pdf');
	fs.mkdirSync(path.dirname(pdf), { recursive: true });
	if (noPdf) fs.writeFileSync(pdf, 'unrelated-stale-pdf');
	const args = noPdf
		? ['audit', report]
		: [
				'generate',
				report,
				'--renderer',
				'word',
				'--pdf-image-quality',
				'print',
				'--validate',
			];
	const result = spawnSync(process.execPath, [tsx, 'src/index.ts', ...args], {
		cwd: process.cwd(),
		encoding: 'utf8',
		timeout: 1_350_000,
	});
	if (result.error) throw result.error;
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const manifest = JSON.parse(
		fs.readFileSync(output.replace(/\.docx$/, '.acceptance.json'), 'utf8'),
	);
	assert.equal(manifest.status, 'accepted');
	assert.equal(manifest.postBuild.pdf_image_quality, 'print');
	assert.equal(manifest.internalPdfImageQuality, 'print');
	assert.equal(manifest.execution.processCleanupVerified, true);
	assert.equal(manifest.stablePageCount, true);
	assert.doesNotMatch(result.stdout, /PDF original pixels verified/);
	assert.deepEqual(fs.readFileSync(resultsPath), before);
	if (noPdf) {
		assert.equal(manifest.pdf, null);
		assert.equal(fs.readFileSync(pdf, 'utf8'), 'unrelated-stale-pdf');
	} else {
		assert.equal(manifest.pdf.export.requestedImageQuality, 'print');
		assert.equal(manifest.pdf.export.method, 'ExportAsFixedFormat');
		assert.equal(
			manifest.pdf.sha256,
			crypto
				.createHash('sha256')
				.update(fs.readFileSync(pdf))
				.digest('hex'),
		);
	}
	console.log(
		JSON.stringify({
			case: noPdf
				? 'config-print-no-pdf'
				: 'cli-print-over-config-original',
			pages: manifest.pageCountAfterReopen,
			nativeQuality: manifest.postBuild.pdf_image_quality,
			finalQuality: manifest.pdf?.export.requestedImageQuality ?? null,
			processCleanupVerified: true,
			sourcePreserved: true,
		}),
	);
}
console.log('Live Word SVG print and config-only no-PDF tests passed.');
