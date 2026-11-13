import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { scaffoldReport } from '@/app/report-scaffold';
import { readDocxEntry } from '@/shared/lib/docx';

const scratch = process.env.AGENT_STORAGE_SCRATCH;
if (!scratch)
	throw new Error(
		'Live Word tests require task-owned AGENT_STORAGE_SCRATCH.',
	);
const tsx = require.resolve('tsx/cli');
const hash = (file: string) =>
	crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const profile of ['lab', 'coursework'] as const) {
	const report = path.join(scratch, profile);
	scaffoldReport({
		slug: `synthetic-${profile}`,
		dir: report,
		profile,
		initGit: false,
	});
	const configPath = path.join(report, 'report.config.json');
	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	config.renderer = profile === 'coursework' ? 'word' : 'portable';
	config.postBuild.enabled = profile === 'coursework';
	config.postBuild.exportPdf = profile === 'lab';
	fs.writeFileSync(configPath, JSON.stringify(config));
	fs.writeFileSync(
		path.join(report, '10_methodology.md'),
		[
			'# Синтетическая методика',
			'Проверяются только формулы тестового отчёта.',
			...Array.from(
				{ length: 7 },
				(_, index) =>
					`Для случая ${index + 1} используется формула:\n\n$$\n\\frac{x_{${index + 1}}+1}{2}=y_{${index + 1}}\n$$\n\nгде x и y – синтетические переменные.`,
			),
			Array.from(
				{ length: 51 },
				(_, index) => `Параметр $a_{${index + 1}}$ задан в тесте.`,
			).join(' '),
		].join('\n\n') + '\n',
	);
	const sources = fs.readdirSync(report).filter(file => file.endsWith('.md'));
	const sourceHashes = sources.map(file => hash(path.join(report, file)));
	const docx = path.resolve(report, config.outputDocx);
	const pdf = docx.replace(/\.docx$/, '.pdf');
	const manifest = docx.replace(/\.docx$/, '.acceptance.json');
	if (profile === 'coursework') {
		fs.mkdirSync(path.dirname(pdf), { recursive: true });
		fs.writeFileSync(pdf, 'unrelated-stale-pdf');
	}
	const args =
		profile === 'lab'
			? ['generate', report, '--renderer', 'word', '--validate']
			: ['audit', report];
	const result = spawnSync(process.execPath, [tsx, 'src/index.ts', ...args], {
		cwd: process.cwd(),
		encoding: 'utf8',
		shell: false,
		timeout: 1_350_000,
	});
	if (result.error) throw result.error;
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	console.log(result.stdout);
	const evidence = JSON.parse(fs.readFileSync(manifest, 'utf8'));
	assert.equal(evidence.status, 'accepted');
	assert.equal(evidence.execution.processCleanupVerified, true);
	assert.equal(evidence.stablePageCount, true);
	assert.equal(evidence.acceptedDocx.path, docx);
	assert.equal(evidence.acceptedDocx.sha256, hash(docx));
	assert.equal(evidence.postBuild.formula_replacements, 58);
	const xml = readDocxEntry(docx, 'word/document.xml');
	assert.equal((xml.match(/<m:oMath[\s>]/g) ?? []).length, 58);
	assert.ok(!xml.includes('{{PAGES}}'));
	assert.deepEqual(
		sources.map(file => hash(path.join(report, file))),
		sourceHashes,
	);
	if (profile === 'lab') {
		assert.equal(evidence.pdf.sha256, hash(pdf));
		assert.ok(
			fs.readFileSync(pdf).subarray(0, 5).equals(Buffer.from('%PDF-')),
		);
	} else {
		assert.equal(evidence.pdf, null);
		assert.equal(fs.readFileSync(pdf, 'utf8'), 'unrelated-stale-pdf');
		assert.equal(evidence.referatStatistics.pageTextVerified, true);
	}
	assert.ok(
		fs
			.readdirSync(path.dirname(docx))
			.every(
				file =>
					!file.endsWith('.word.lock') &&
					!file.startsWith('.sto-word-render-'),
			),
	);
	console.log(
		JSON.stringify({
			profile,
			command: args[0],
			configOnly: profile === 'coursework',
			pages: evidence.pageCountAfterReopen,
			formulas: 58,
			docxSha256: hash(docx),
			pdfSha256: evidence.pdf?.sha256 ?? null,
			cleanupVerified: true,
		}),
	);
}
console.log('Live native Word renderer lab/coursework tests passed.');
