import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { scaffoldReport } from '@/app/report-scaffold';
import {
	reportReadmeLinkTarget,
	reportReadmeTemplate,
} from '@/app/report-scaffold-readme';
import { runSourcePreflight } from '@/shared/lib/source-preflight';

const tempRoot = path.join(process.cwd(), '.agent-work', 'scaffold-tests');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
process.once('exit', () =>
	fs.rmSync(tempRoot, { recursive: true, force: true }),
);

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
function verifyReadme(
	targetDir: string,
	runnerDir: string,
	installed: boolean,
): void {
	const readme = fs.readFileSync(path.join(targetDir, 'README.md'), 'utf8');
	const commands = readme
		.split(/\r?\n/)
		.filter(line => line.startsWith('    '))
		.map(line => line.trim());
	assert.equal(commands.length, 4);
	assert.equal(path.resolve(targetDir, commands[0].slice(4, -1)), runnerDir);
	const reportPath = `'${path.relative(runnerDir, targetDir).split(path.sep).join('/') || '.'}'`;
	const check = installed
		? 'npx sto-report-generator check'
		: 'npm run check:source --';
	const generate = installed
		? 'npx sto-report-generator generate'
		: 'npm run generate:report --';
	assert.equal(commands[1], `${check} ${reportPath}`);
	assert.equal(
		commands[2],
		`${generate} ${reportPath} --renderer portable --validate`,
	);
	assert.equal(
		commands[3],
		`${generate} ${reportPath} --renderer word --validate`,
	);
	const links = [...readme.matchAll(/\]\(<([^>]+)>\)/g)].map(
		match => match[1],
	);
	assert.equal(links.length, 5);
	for (const suffix of [
		'.agents/skills/sto-report-generator/SKILL.md',
		'.agents/skills/sto-report-generator/references/scientific-prose.md',
		'.agents/skills/humanizer-ru/SKILL.md',
		'docs/report-authoring.md',
		'docs/case-studies/README.md',
	]) {
		const link = links.find(link => link.endsWith(suffix));
		assert.ok(link, `README must link to ${suffix}`);
		assert.ok(
			fs.existsSync(path.resolve(targetDir, decodeURIComponent(link))),
			`README link must resolve: ${link}`,
		);
	}
	const checked = spawnSync(
		process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
		process.platform === 'win32'
			? [
					'-NoProfile',
					'-NonInteractive',
					'-ExecutionPolicy',
					'Bypass',
					'-Command',
					commands[1],
				]
			: ['-c', commands[1]],
		{
			cwd: runnerDir,
			encoding: 'utf8',
			env: {
				...process.env,
				npm_config_offline: 'true',
				npm_config_yes: 'false',
			},
			timeout: 30_000,
		},
	);
	assert.equal(checked.status, 0, checked.stderr || checked.stdout);
}

verifyReadme(result.targetDir, process.cwd(), false);

const consumerDir = path.join(tempRoot, 'consumer project');
const packageLink = path.join(
	consumerDir,
	'node_modules',
	'sto-report-generator',
);
fs.mkdirSync(path.join(consumerDir, 'node_modules', '.bin'), {
	recursive: true,
});
fs.writeFileSync(
	path.join(consumerDir, 'package.json'),
	JSON.stringify({
		private: true,
		dependencies: { 'sto-report-generator': '*' },
	}),
);
fs.symlinkSync(process.cwd(), packageLink, 'junction');
const installedBin = path.join(packageLink, 'bin', 'sto-report-generator.cjs');
const windows = process.platform === 'win32';
fs.writeFileSync(
	path.join(
		consumerDir,
		'node_modules',
		'.bin',
		windows ? 'sto-report-generator.cmd' : 'sto-report-generator',
	),
	windows
		? `@echo off\r\n"${process.execPath}" "${installedBin}" %*\r\n`
		: `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(installedBin)} "$@"\n`,
	{ mode: 0o755 },
);
for (const dir of [
	'nested/report with spaces',
	path.join(tempRoot, 'absolute report with spaces'),
]) {
	const consumerReport = scaffoldReport({
		slug: 'consumer_report',
		profile: 'lab',
		cwd: consumerDir,
		dir,
		initGit: false,
	});
	verifyReadme(consumerReport.targetDir, consumerDir, true);
}
const checkoutReport = scaffoldReport({
	slug: 'checkout_report',
	profile: 'lab',
	dir: path.join(tempRoot, 'checkout report with spaces'),
	initGit: false,
});
verifyReadme(checkoutReport.targetDir, process.cwd(), false);

// Inspect shell text as data: never execute command-substitution fixtures.
const literalPath =
	'reports/$(__scaffold_must_not_execute__) `__scaffold_must_not_execute__`';
const literalTarget = path.join(consumerDir, literalPath);
const literalReadme = reportReadmeTemplate(
	'literal_report',
	literalTarget,
	'lab',
	consumerDir,
);
assert.match(literalReadme, /Bash\/zsh и PowerShell/);
assert.ok(
	literalReadme.includes(`npx sto-report-generator check '${literalPath}'`),
);
assert.ok(
	!literalReadme.includes(`npx sto-report-generator check "${literalPath}"`),
);

const apostrophePath =
	"reports/author's $(__scaffold_must_not_execute__) `literal`";
const apostropheReadme = reportReadmeTemplate(
	'apostrophe_report',
	path.join(consumerDir, apostrophePath),
	'lab',
	consumerDir,
);
const [posixSection, powershellSection] = apostropheReadme.split('PowerShell:');
assert.ok(
	posixSection.includes(
		`npx sto-report-generator check 'reports/author'"'"'s $(__scaffold_must_not_execute__) \`literal\`'`,
	),
);
assert.ok(
	powershellSection.includes(
		"npx sto-report-generator check 'reports/author''s $(__scaffold_must_not_execute__) `literal`'",
	),
);
assert.ok(powershellSection.includes('Set-Location -LiteralPath'));
assert.ok(
	!posixSection.includes("npx sto-report-generator check 'reports/author's"),
);
assert.ok(
	!powershellSection.includes(
		`npx sto-report-generator check 'reports/author'"'"'s`,
	),
);

const literalConsumer = path.join(
	tempRoot,
	"consumer's $(__scaffold_must_not_execute__) `literal`",
);
fs.mkdirSync(path.join(literalConsumer, 'node_modules'), { recursive: true });
fs.symlinkSync(
	process.cwd(),
	path.join(literalConsumer, 'node_modules', 'sto-report-generator'),
	'junction',
);
const literalRunnerReadme = reportReadmeTemplate(
	'runner_report',
	path.join(tempRoot, 'runner report'),
	'lab',
	literalConsumer,
);
const [posixRunner, powershellRunner] =
	literalRunnerReadme.split('PowerShell:');
assert.ok(
	posixRunner.includes(
		`cd -- '../consumer'"'"'s $(__scaffold_must_not_execute__) \`literal\`'`,
	),
);
assert.ok(
	powershellRunner.includes(
		"Set-Location -LiteralPath '../consumer''s $(__scaffold_must_not_execute__) `literal`'",
	),
);
const runnerLinks = [...literalRunnerReadme.matchAll(/\]\(<([^>]+)>\)/g)];
assert.equal(runnerLinks.length, 5);
for (const [, link] of runnerLinks) {
	assert.ok(
		link.includes('%24(__scaffold_must_not_execute__)%20%60literal%60'),
	);
	assert.ok(
		fs.existsSync(
			path.resolve(tempRoot, 'runner report', decodeURIComponent(link)),
		),
	);
}

assert.equal(
	reportReadmeLinkTarget('../docs/space # question? <tag> %.md'),
	'../docs/space%20%23%20question%3F%20%3Ctag%3E%20%25.md',
);
const crossDrive = path.win32
	.relative(
		'D:\\reports\\new report',
		'C:\\project files\\docs\\author #1.md',
	)
	.split('\\')
	.join('/');
assert.equal(crossDrive, 'C:/project files/docs/author #1.md');
assert.equal(
	reportReadmeLinkTarget(crossDrive),
	'file:///C:/project%20files/docs/author%20%231.md',
);
assert.equal(
	reportReadmeLinkTarget('//server/shared files/docs/author #1.md'),
	'file://server/shared%20files/docs/author%20%231.md',
);

assert.match(
	fs.readFileSync(path.join(result.targetDir, '01_referat.md'), 'utf8'),
	/Пояснительная записка: \{\{PAGES\}\} с\., \{\{FIGURES\}\}, \{\{TABLES\}\}, \{\{SOURCES\}\}, \{\{APPENDICES\}\}\./,
);
const scaffoldPreflight = runSourcePreflight(result.targetDir);
assert.match(
	fs.readFileSync(path.join(result.targetDir, '00_metadata.md'), 'utf8'),
	/bibliographyEvidence: required/,
);
assert.doesNotMatch(
	fs.readFileSync(path.join(result.targetDir, 'references.bib'), 'utf8'),
	/@article|example2026/,
);
assert.equal(
	scaffoldPreflight.passed,
	true,
	scaffoldPreflight.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

assert.deepEqual(
	scaffoldPreflight.issues.filter(item => /formula|where/u.test(item.code)),
	[],
	'New report template must satisfy formula punctuation without warnings',
);
fs.appendFileSync(
	path.join(result.targetDir, '03_intro.md'),
	'\nПроверяемый источник [@unchecked].\n',
);
fs.appendFileSync(
	path.join(result.targetDir, 'references.bib'),
	'@online{unchecked,title={Synthetic control},url={https://example.org},urldate={2020-01-01}}\n',
);
assert.ok(
	runSourcePreflight(result.targetDir).issues.some(
		item => item.code === 'bibliography-evidence-missing',
	),
	'A newly cited source in a scaffold requires real metadata evidence',
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

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('Scaffold tests passed.');
