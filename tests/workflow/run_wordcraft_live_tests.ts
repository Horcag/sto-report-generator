import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildReport } from '@/app/builder';
import { generateReport } from '@/app/report-workflow';
import {
	createWordcraftPdf,
	readWordcraftVersion,
} from '@/app/wordcraft-renderer';

import { verifyLiveWordcraftFields } from './wordcraft_live_fields';

const root = path.resolve(__dirname, '../..');
const hash = (file: string): string =>
	createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main(): Promise<void> {
	readWordcraftVersion();
	const retainedOutput = process.env.WORDCRAFT_TEST_OUTPUT;
	const directory = retainedOutput
		? path.resolve(retainedOutput)
		: fs.mkdtempSync(path.join(os.tmpdir(), 'sto-wordcraft-live-'));
	// An explicit evidence destination must be new; never reuse or clean user data.
	if (retainedOutput) fs.mkdirSync(directory);
	try {
		const example = path.join(directory, 'example');
		fs.cpSync(path.join(root, 'example'), example, { recursive: true });
		const generated = await generateReport({
			reportDir: example,
			renderer: 'wordcraft',
			validate: true,
		});
		assert.ok(generated.wordcraft);
		assert.equal(generated.postBuildRan, false);
		verifyLiveWordcraftFields(
			generated.outputDocx,
			path.join(directory, 'fields'),
		);
		console.log(
			'LIVE fields: stale TOC refreshed, numbered entries preserved, dirty flag cleared.',
		);
		const corpus = path.join(directory, 'corpus');
		fs.cpSync(path.join(root, 'tests/fixtures/dotm-word-corpus'), corpus, {
			recursive: true,
		});
		// This legacy style corpus uses the example figure. Copy its canonical
		// SVG/PNG pair so the current source geometry and fallback stay aligned.
		for (const asset of ['dummy.svg', 'dummy.png']) {
			fs.copyFileSync(
				path.join(root, 'example/images', asset),
				path.join(corpus, 'images', asset),
			);
		}
		const corpusDocx = path.join(corpus, 'report.docx');
		const bodyPath = path.join(corpus, '03_body.md');
		const extraRows = Array.from(
			{ length: 60 },
			(_, index) =>
				`| ${index + 31} | Одинаковое содержание строки для проверки переноса. |`,
		).join('\n');
		fs.writeFileSync(
			bodyPath,
			fs
				.readFileSync(bodyPath, 'utf8')
				.replace(
					'\n\nПосле таблицы',
					`\n${extraRows}\n\nПосле таблицы`,
				),
		);
		// This style fixture deliberately includes source-preflight violations.
		await buildReport(corpus, corpusDocx);
		const before = hash(corpusDocx);
		const rendered = createWordcraftPdf({ inputDocx: corpusDocx });
		assert.equal(hash(corpusDocx), before);
		const mathSource = path.join(directory, 'math.md');
		fs.writeFileSync(
			mathSource,
			fs
				.readFileSync(path.join(root, 'example/00_metadata.md'), 'utf8')
				.replace(/^bibliography:.*\n/m, '') +
				'\n' +
				fs.readFileSync(
					path.join(
						root,
						'tests/fixtures/wordcraft/math-controls.md',
					),
					'utf8',
				),
		);
		const mathDocx = path.join(directory, 'math.docx');
		await buildReport(mathSource, mathDocx);
		const mathResult = createWordcraftPdf({ inputDocx: mathDocx });
		for (const result of [generated.wordcraft, rendered, mathResult]) {
			const manifest = JSON.parse(
				fs.readFileSync(result.manifestPath, 'utf8'),
			);
			assert.equal(manifest.experimental, true);
			assert.equal(manifest.wordAccepted, false);
			assert.equal(manifest.pdfPageCountVerified, false);
			assert.equal(manifest.pdfSha256, hash(result.outputPdf));
			assert.equal(manifest.sourceSha256, hash(manifest.inputDocx));
			assert.equal(manifest.version, '0.8.0');
			assert.ok(result.pageCount > 1);
			console.log(
				`LIVE ${path.basename(path.dirname(result.outputPdf))}: ${result.pageCount} layout pages, source preserved, PDF hash verified.`,
			);
		}
		console.log(
			'Wordcraft live smoke passed (example + 90-row table + math/appendix controls). PDF visual/Word acceptance is separate.',
		);
	} finally {
		if (retainedOutput)
			console.log(`Live artifacts retained at ${directory}`);
		else fs.rmSync(directory, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
