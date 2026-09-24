import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readDocxEntry } from '@/shared/lib/docx-archive';

interface AcceptanceManifest {
	status: string;
	stablePageCount: boolean;
	referatStatistics: {
		pages: number;
		figures: number;
		tables: number;
		sources: number;
		placeholdersCleared: boolean;
	};
}

const placeholders = /\{\{(?:PAGES|PAGES_WORD|FIGURES|TABLES|SOURCES)\}\}/;

function main(): void {
	const [docxPath, pdfPath, manifestPath] = process.argv.slice(2);
	assert.ok(
		docxPath && pdfPath && manifestPath,
		'Usage: check_accepted_referat <docx> <pdf> <manifest>',
	);
	const manifest = JSON.parse(
		fs.readFileSync(manifestPath, 'utf8'),
	) as AcceptanceManifest;
	assert.equal(manifest.status, 'accepted');
	assert.equal(manifest.stablePageCount, true);
	assert.equal(manifest.referatStatistics.placeholdersCleared, true);

	const docxXml = readDocxEntry(docxPath, 'word/document.xml');
	const docxText = [...docxXml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)]
		.map(match => match[1])
		.join('');
	assert.doesNotMatch(docxText, placeholders);
	const pdfToText = process.env.STO_PDFTOTEXT ?? 'pdftotext';
	let hostPdfPath = path.resolve(pdfPath);
	if (
		process.platform === 'linux' &&
		pdfToText.toLowerCase().endsWith('.exe')
	) {
		const converted = spawnSync('wslpath', ['-w', hostPdfPath], {
			encoding: 'utf8',
			shell: false,
		});
		assert.equal(converted.status, 0, converted.stderr);
		hostPdfPath = converted.stdout.trim();
	}
	const result = spawnSync(pdfToText, [hostPdfPath, '-'], {
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) throw result.error;
	assert.equal(result.status, 0, result.stderr);
	const pdfText = result.stdout;
	assert.doesNotMatch(pdfText, placeholders);
	assert.equal(
		pdfText.split('\f').length - 1,
		manifest.referatStatistics.pages,
	);

	const summary = manifest.referatStatistics;
	for (const [count, forms] of [
		[summary.figures, ['рисунок', 'рисунка', 'рисунков']],
		[summary.tables, ['таблица', 'таблицы', 'таблиц']],
		[summary.sources, ['источник', 'источника', 'источников']],
	] as const) {
		if (count === 0) continue;
		const lastTwo = count % 100;
		const word =
			lastTwo > 10 && lastTwo < 20
				? forms[2]
				: count % 10 === 1
					? forms[0]
					: count % 10 > 1 && count % 10 < 5
						? forms[1]
						: forms[2];
		const statistic = `${count} ${word}`;
		assert.ok(
			docxText.includes(statistic),
			`Accepted DOCX lacks ${statistic}`,
		);
		assert.ok(
			pdfText.includes(statistic),
			`Accepted PDF lacks ${statistic}`,
		);
	}
	console.log(
		`Accepted DOCX/PDF referat statistics verified: ${summary.pages} pages, ${summary.figures} figures, ${summary.tables} tables, ${summary.sources} sources.`,
	);
}

main();
