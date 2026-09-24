import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function toPowerShellPath(absolutePath: string): string {
	if (process.platform === 'win32') return absolutePath;
	const conversion = spawnSync('wslpath', ['-w', absolutePath], {
		encoding: 'utf8',
	});
	assert.equal(conversion.status, 0, conversion.stderr);
	return conversion.stdout.trim();
}

export function testPowerShellHashFallback(): void {
	const executable = 'powershell.exe';
	const availability = spawnSync(executable, [
		'-NoProfile',
		'-Command',
		'exit 0',
	]);
	if (availability.error) return;

	const fixturePath = path.resolve('package.json');
	const scriptPath = path.resolve('scripts', 'word_acceptance.ps1');
	const expected = createHash('sha256')
		.update(readFileSync(fixturePath))
		.digest('hex');
	const calculate = (forceFallback: boolean): string => {
		const args = [
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			toPowerShellPath(scriptPath),
			'-HashOnlyPath',
			toPowerShellPath(fixturePath),
		];
		if (forceFallback) args.push('-ForceHashFallback');
		const result = spawnSync(executable, args, { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};

	assert.equal(calculate(false), expected);
	assert.equal(calculate(true), expected);
	const dispatch = spawnSync(
		executable,
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			toPowerShellPath(
				path.resolve('tests/workflow/word_pdf_export_test.ps1'),
			),
		],
		{ encoding: 'utf8', timeout: 30_000 },
	);
	assert.equal(
		dispatch.status,
		0,
		dispatch.stderr || dispatch.error?.message,
	);
	assert.match(dispatch.stdout, /Typed PDF dispatch test passed/);
}
