import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { scaffoldReport } from '../src/app/report-scaffold';
import { runSourcePreflight } from '../src/shared/lib/source-preflight';

const tempRoot = path.join(process.cwd(), '.agent-work', 'scaffold-tests');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const result = scaffoldReport({
	slug: 'demo_report',
	dir: path.join(tempRoot, 'demo_report'),
	title: 'Демонстрационный отчет',
	studentName: 'Иванов Иван Иванович',
	initGit: true,
});

for (const expectedFile of [
	'00_metadata.md',
	'01_referat.md',
	'02_toc.md',
	'03_intro.md',
	'10_methodology.md',
	'20_data.md',
	'30_results.md',
	'90_conclusion.md',
	'91_sources.md',
	'references.bib',
	'report.config.json',
	'.gitignore',
	'images/.gitkeep',
]) {
	assert.ok(
		fs.existsSync(path.join(result.targetDir, expectedFile)),
		`${expectedFile} must be created`,
	);
}

assert.equal(result.gitInitialized, true);
assert.ok(fs.existsSync(path.join(result.targetDir, '.git')));
const scaffoldPreflight = runSourcePreflight(result.targetDir);
assert.equal(
	scaffoldPreflight.passed,
	true,
	scaffoldPreflight.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

fs.writeFileSync(path.join(tempRoot, 'occupied.txt'), 'x', 'utf8');
assert.throws(
	() =>
		scaffoldReport({
			slug: 'occupied',
			dir: tempRoot,
			initGit: false,
		}),
	/Target report directory is not empty/,
);

console.log('Scaffold tests passed.');
