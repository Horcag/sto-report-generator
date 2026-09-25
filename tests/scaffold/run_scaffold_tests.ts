import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { scaffoldReport } from '@/app/report-scaffold';
import { runSourcePreflight } from '@/shared/lib/source-preflight';

const tempRoot = path.join(process.cwd(), '.agent-work', 'scaffold-tests');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const result = scaffoldReport({
	slug: 'demo_report',
	profile: 'nir',
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
assert.match(
	fs.readFileSync(path.join(result.targetDir, '01_referat.md'), 'utf8'),
	/Пояснительная записка: \{\{PAGES\}\} с\., \{\{FIGURES\}\}, \{\{TABLES\}\}, \{\{SOURCES\}\}, \{\{APPENDICES\}\}\./,
);
const scaffoldPreflight = runSourcePreflight(result.targetDir);
assert.equal(
	scaffoldPreflight.passed,
	true,
	scaffoldPreflight.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

const courseworkResult = scaffoldReport({
	slug: 'coursework_demo',
	dir: path.join(tempRoot, 'coursework_demo'),
	profile: 'coursework',
	title: 'Демонстрационная курсовая работа',
	initGit: false,
});
assert.ok(
	fs.existsSync(path.join(courseworkResult.targetDir, '01_referat.md')),
	'coursework profile must include referat',
);
assert.ok(
	fs.existsSync(path.join(courseworkResult.targetDir, '91_sources.md')),
	'coursework profile must include sources template',
);
const courseworkPreflight = runSourcePreflight(courseworkResult.targetDir);
assert.equal(
	courseworkPreflight.passed,
	true,
	courseworkPreflight.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

const labResult = scaffoldReport({
	slug: 'lab_demo',
	dir: path.join(tempRoot, 'lab_demo'),
	profile: 'lab',
	title: 'Демонстрационная лабораторная работа',
	initGit: false,
});
assert.ok(
	!fs.existsSync(path.join(labResult.targetDir, '01_referat.md')),
	'lab profile must not create referat by default',
);
assert.ok(
	!fs.existsSync(path.join(labResult.targetDir, '91_sources.md')),
	'lab profile must not create sources by default when there are no citations',
);
const labMetadata = fs.readFileSync(
	path.join(labResult.targetDir, '00_metadata.md'),
	'utf8',
);
assert.match(labMetadata, /reportProfile: "lab"/);
assert.match(labMetadata, /supervisorName: ""/);
assert.match(labMetadata, /hideSignatures: true/);
const labPreflight = runSourcePreflight(labResult.targetDir);
assert.equal(
	labPreflight.passed,
	true,
	labPreflight.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

for (const profile of ['vkr-bachelor', 'vkr-master'] as const) {
	const vkrResult = scaffoldReport({
		slug: `${profile}_demo`,
		dir: path.join(tempRoot, `${profile}_demo`),
		profile,
		title: `Демонстрационная ${profile} работа`,
		initGit: false,
	});
	const metadata = fs.readFileSync(
		path.join(vkrResult.targetDir, '00_metadata.md'),
		'utf8',
	);
	assert.match(metadata, new RegExp(`reportProfile: "${profile}"`));
	assert.match(
		metadata,
		new RegExp(
			`specialtyCode: "${profile === 'vkr-master' ? '01.04.02' : '01.03.02'}"`,
		),
	);
	assert.match(metadata, /normControllerName:/);
	assert.match(metadata, /vkrOrderNumber:/);
	assert.match(metadata, /vkrQuestions:/);
	assert.ok(fs.existsSync(path.join(vkrResult.targetDir, '01_referat.md')));
	assert.equal(
		runSourcePreflight(vkrResult.targetDir).passed,
		true,
		`${profile} scaffold must pass source preflight`,
	);
	if (profile === 'vkr-bachelor') {
		fs.writeFileSync(
			path.join(vkrResult.targetDir, '00_metadata.md'),
			metadata.replace(/vkrOrderNumber:[^\r\n]*\r?\n/, ''),
			'utf8',
		);
		assert.ok(
			runSourcePreflight(vkrResult.targetDir).issues.some(
				item =>
					item.code === 'metadata-vkr-assignment-field-missing' &&
					item.message.includes('vkrOrderNumber'),
			),
		);
	}
}

assert.throws(
	() => scaffoldReport({ slug: 'implicit_profile', initGit: false }),
	/Select a report profile/,
);

fs.writeFileSync(path.join(tempRoot, 'occupied.txt'), 'x', 'utf8');
assert.throws(
	() =>
		scaffoldReport({
			slug: 'occupied',
			dir: tempRoot,
			profile: 'nir',
			initGit: false,
		}),
	/Target report directory is not empty/,
);

console.log('Scaffold tests passed.');
