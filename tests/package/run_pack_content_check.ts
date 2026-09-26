import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

interface PackedFile {
	path: string;
}

interface PackResult {
	files: PackedFile[];
}

const tsxCliPath = require.resolve('tsx/cli');

const forbiddenPrefixes = [
	'.github/',
	'.omx/',
	'.venv/',
	'.agent-work/',
	'kanban/',
	'node_modules/',
	'output/',
	'reports/',
	'research/',
	'tests/',
];

const forbiddenExactPaths = new Set([
	'.geminiignore',
	'.gitignore',
	'.pre-commit-config.yaml',
	'.prettierignore',
	'.python-version',
	'eslint.config.mjs',
	'package-lock.json',
	'steiger.config.ts',
]);

function runPackDryRun(): PackResult[] {
	const npmCliPath = process.env.npm_execpath;
	if (!npmCliPath) {
		throw new Error('npm_execpath is required to run the package audit.');
	}
	const result = spawnSync(
		process.execPath,
		[npmCliPath, 'pack', '--dry-run', '--json'],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			shell: false,
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`npm pack --dry-run --json exited with ${result.status}:\n${result.stderr}`,
		);
	}

	try {
		return JSON.parse(result.stdout) as PackResult[];
	} catch (error) {
		throw new Error(
			`npm pack --dry-run --json returned invalid JSON: ${(error as Error).message}`,
			{ cause: error },
		);
	}
}

function runPortableExampleAudit(): void {
	const result = spawnSync(
		process.execPath,
		[
			tsxCliPath,
			'src/index.ts',
			'audit',
			'example',
			'--renderer',
			'portable',
		],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			shell: false,
		},
	);

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`portable example audit exited with ${result.status}:\n${result.stdout}\n${result.stderr}`,
		);
	}
}

function isForbiddenPath(filePath: string): boolean {
	return (
		(filePath.startsWith('.agents/') &&
			!filePath.startsWith('.agents/skills/humanizer-ru/')) ||
		forbiddenExactPaths.has(filePath) ||
		forbiddenPrefixes.some(prefix => filePath.startsWith(prefix)) ||
		filePath.startsWith('.temp') ||
		filePath.endsWith('.docx') ||
		filePath.endsWith('.pdf') ||
		filePath.endsWith('.acceptance.json') ||
		filePath.endsWith('.log')
	);
}

function assertRequiredFiles(packedFiles: PackedFile[]): void {
	const packedPaths = new Set(packedFiles.map(file => file.path));
	const requiredPaths = [
		'.agents/skills/humanizer-ru/SKILL.md',
		'.agents/skills/humanizer-ru/LICENSE',
		'.agents/skills/humanizer-ru/references/rewrite-guide.md',
		'.agents/skills/humanizer-ru/knowledge/corrections.md',
		'.agents/skills/humanizer-ru/scripts/check_all.py',
		'.agents/skills/humanizer-ru/src/humanizer_ru/__init__.py',
		'.agents/skills/humanizer-ru/tests/test_markers_cases.py',
		'LICENSE',
		'bin/sto-report-generator.cjs',
		'scripts/check_word_license.ps1',
		'scripts/word_acceptance.ps1',
	];
	const missingPaths = requiredPaths.filter(
		filePath => !packedPaths.has(filePath),
	);
	if (missingPaths.length > 0) {
		console.error('Required files are missing from npm package:');
		for (const filePath of missingPaths) {
			console.error(`- ${filePath}`);
		}
		process.exit(1);
	}
}

const generatedExampleDocx = path.join(
	process.cwd(),
	'example',
	'build',
	'example.docx',
);
const hadGeneratedExampleDocx = existsSync(generatedExampleDocx);

try {
	runPortableExampleAudit();

	const packResults = runPackDryRun();
	const packedFiles = packResults.flatMap(result => result.files ?? []);
	const forbiddenFiles = packedFiles
		.map(file => file.path)
		.filter(isForbiddenPath)
		.sort();

	if (forbiddenFiles.length > 0) {
		console.error('Forbidden files would be included in npm package:');
		for (const filePath of forbiddenFiles) {
			console.error(`- ${filePath}`);
		}
		process.exit(1);
	}

	if (packedFiles.length === 0) {
		console.error('npm pack did not report any packaged files.');
		process.exit(1);
	}
	assertRequiredFiles(packedFiles);

	console.log(
		`Package content check passed for ${packedFiles.length} files after portable example audit.`,
	);
} finally {
	if (!hadGeneratedExampleDocx && existsSync(generatedExampleDocx)) {
		rmSync(generatedExampleDocx);
	}
}
