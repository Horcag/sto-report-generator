import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';
import { readDocxEntry } from '@/shared/lib/docx';

import { assertReferatPageCountText } from './check_accepted_referat';
import { toPowerShellPath } from './word_acceptance_hash_test';

const tempDir = path.resolve('.agent-work/referat-statistics-test');

function testFinalPageStatistics(): void {
	for (const executable of ['pwsh', 'powershell.exe']) {
		const probe = spawnSync(
			executable,
			['-NoProfile', '-Command', 'exit 0'],
			{
				timeout: 5000,
				windowsHide: true,
			},
		);
		if (probe.error || probe.status !== 0) continue;
		const file = path.resolve(
			'tests/workflow/word_referat_statistics_test.ps1',
		);
		const result = spawnSync(
			executable,
			[
				'-NoProfile',
				'-File',
				executable === 'powershell.exe' ? toPowerShellPath(file) : file,
			],
			{ encoding: 'utf8', timeout: 30000, windowsHide: true },
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /tests passed: 8 cases/);
		process.stdout.write(result.stdout);
		return;
	}
	console.log(
		'SKIP referat PowerShell cases: no PowerShell runtime available.',
	);
}

function statistics(docxPath: string): Record<string, unknown> {
	const result = spawnSync(
		'uv',
		[
			'run',
			'python',
			'-m',
			'scripts.sto_post_build.acceptance_statistics',
			docxPath,
		],
		{ encoding: 'utf8', shell: false },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.ok(Buffer.from(result.stdout, 'utf8').every(byte => byte < 128));
	return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function main(): Promise<void> {
	assertReferatPageCountText('Записка: 24 страницы, 1 таблица.', 24);
	assertReferatPageCountText('Записка: 24 с., 1 таблица.', 24);
	for (const stale of ['Записка: 124 страницы.', 'Записка: 124 с.']) {
		assert.throws(() => assertReferatPageCountText(stale, 24));
	}
	assert.throws(() => assertReferatPageCountText('24 страниц.', 24));
	assertReferatPageCountText('11 страниц.', 11);
	assertReferatPageCountText('121 страницу.', 121);
	console.log(
		'Exact referat page tokens passed: full words, abbreviation, stale 124 vs24 and word forms.',
	);
	testFinalPageStatistics();
	fs.mkdirSync(tempDir, { recursive: true });
	const exampleDocx = path.join(tempDir, 'example.docx');
	await buildReport('example', exampleDocx);
	assert.match(
		readDocxEntry(exampleDocx, 'word/document.xml'),
		/\{\{PAGES\}\}/,
	);
	assert.deepEqual(statistics(exampleDocx), {
		figures: 1,
		tables: 1,
		sources: 1,
		appendices: 0,
		replacements: {
			'{{FIGURES}}': '1 рисунок',
			'{{TABLES}}': '1 таблица',
			'{{SOURCES}}': '1 источник',
			'{{APPENDICES}}': '0 приложений',
		},
	});

	const labDir = path.join(tempDir, 'lab');
	fs.mkdirSync(labDir, { recursive: true });
	fs.writeFileSync(
		path.join(labDir, '00_metadata.md'),
		'---\ntitle: Test\nauthor: Test\nyear: 2026\n---\n\n\\sto_structural_heading{ВВЕДЕНИЕ}\n\nТекст лабораторной работы.\n',
	);
	const labDocx = path.join(tempDir, 'lab.docx');
	await buildReport(labDir, labDocx);
	assert.deepEqual(statistics(labDocx), {
		figures: 0,
		tables: 0,
		sources: 0,
		appendices: 0,
		replacements: {
			'{{FIGURES}}': '',
			'{{TABLES}}': '',
			'{{SOURCES}}': '',
			'{{APPENDICES}}': '0 приложений',
		},
	});
	console.log('Referat statistics contract tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
