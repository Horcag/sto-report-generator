import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';
import { readDocxEntry } from '@/shared/lib/docx-archive';

const tempDir = path.resolve('.agent-work/referat-statistics-test');

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
	return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function main(): Promise<void> {
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
		replacements: {
			'{{FIGURES}}': '1 рисунок',
			'{{TABLES}}': '1 таблица',
			'{{SOURCES}}': '1 источник',
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
		replacements: {
			'{{FIGURES}}': '',
			'{{TABLES}}': '',
			'{{SOURCES}}': '',
		},
	});
	console.log('Referat statistics contract tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
