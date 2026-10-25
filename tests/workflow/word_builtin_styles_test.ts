import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { toPowerShellPath } from './word_acceptance_hash_test';

const script = path.resolve('tests/workflow/word_builtin_styles_test.ps1');
const native = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const probe = spawnSync(native, ['-NoProfile', '-Command', 'exit 0'], {
	timeout: 30_000,
});
const executable = probe.error ? 'powershell.exe' : native;
const available = probe.error
	? spawnSync(executable, ['-NoProfile', '-Command', 'exit 0'], {
			timeout: 30_000,
		})
	: probe;
if (available.error) {
	console.log('SKIP built-in style AST mocks: PowerShell unavailable.');
} else {
	const result = spawnSync(
		executable,
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			executable === 'pwsh' ? script : toPowerShellPath(script),
		],
		{ encoding: 'utf8', timeout: 30_000 },
	);
	assert.equal(
		result.status,
		0,
		result.stderr || result.error?.message || result.stdout,
	);
	assert.match(
		result.stdout,
		/32 numeric cases and 11 saved\/custom\/failure cases passed; both functions executed/,
	);
	assert.match(
		result.stdout,
		/8 roles, 8 rejection cases and 2 localized heading lookups passed/,
	);
	assert.match(
		result.stdout,
		/Localized TOC Heading effective bold lookup passed/,
	);
	console.log(result.stdout.trim());
}
