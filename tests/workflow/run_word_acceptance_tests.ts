import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	createWordAcceptancePlan,
	detectWordAcceptanceHost,
	WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
} from '@/app/word-acceptance';
import { getStoStylePresetDisplayNames } from '@/shared/config';

function fakeHostPath(absolutePath: string): string {
	return `WIN:${absolutePath}`;
}

function toPowerShellPath(absolutePath: string): string {
	if (process.platform === 'win32') return absolutePath;
	const conversion = spawnSync('wslpath', ['-w', absolutePath], {
		encoding: 'utf8',
	});
	assert.equal(conversion.status, 0, conversion.stderr);
	return conversion.stdout.trim();
}

function testPowerShellHashFallback(): void {
	const executable =
		process.platform === 'win32' ? 'powershell.exe' : 'powershell.exe';
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
}

function testPowerShellUsesShortWordStagingPaths(): void {
	const script = readFileSync(
		path.resolve('scripts', 'word_acceptance.ps1'),
		'utf8',
	);
	assert.match(script, /GetTempPath\(\)/);
	assert.match(
		script,
		/\$word\.Documents\.Open\(\$stagedInputDocx, \$false, \$false\)/,
	);
	assert.match(
		script,
		/Copy-Item -LiteralPath \$stagedAcceptedDocx -Destination \$request\.acceptedDocx/,
	);
	assert.match(script, /\$document\.Save\(\)/);
	assert.doesNotMatch(script, /\$document\.SaveAs2\(/);
	assert.match(
		script,
		/Remove-Item -LiteralPath \$stagingDirectory -Recurse -Force/,
	);
	assert.match(script, /\$Document\.Styles\.Item\(\[string\]\$DisplayName\)/);
	assert.doesNotMatch(
		script,
		/foreach \(\$style in @\(\$Document\.Styles\)\)/,
	);
	assert.match(script, /System\.Drawing\.Text\.InstalledFontCollection/);
	assert.doesNotMatch(script, /\$Word\.FontNames/);
}

function main(): void {
	const inputDocx = path.join(
		process.cwd(),
		'example',
		'build',
		'report.docx',
	);
	const requestJsonPath = path.join(
		process.cwd(),
		'.agent-work',
		'word-acceptance-test',
		'request.json',
	);
	const plan = createWordAcceptancePlan(
		{
			inputDocx,
			stylePreset: 'samara-template-2022',
		},
		{
			hostKind: 'wsl',
			toHostPath: fakeHostPath,
			requestJsonPath,
		},
	);

	assert.equal(plan.hostKind, 'wsl');
	assert.equal(plan.command, 'powershell.exe');
	assert.deepEqual(plan.args.slice(0, 4), [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
		'-File',
	]);
	assert.equal(
		plan.request.schemaVersion,
		WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
	);
	assert.equal(plan.request.requiredFont, 'Times New Roman');
	assert.equal(plan.request.stylePreset, 'samara-template-2022');
	assert.equal(plan.request.inputDocx, `WIN:${path.resolve(inputDocx)}`);
	assert.equal(
		plan.request.acceptedDocx,
		`WIN:${path.resolve(inputDocx).replace(/\.docx$/, '.accepted.docx')}`,
	);
	assert.equal(
		plan.request.pdf,
		`WIN:${path.resolve(inputDocx).replace(/\.docx$/, '.accepted.pdf')}`,
	);
	assert.equal(
		plan.request.manifest,
		`WIN:${path.resolve(inputDocx).replace(/\.docx$/, '.acceptance.json')}`,
	);

	const expectedStyleMap = getStoStylePresetDisplayNames(
		'samara-template-2022',
	);
	assert.ok(expectedStyleMap.StoHeading1);
	assert.ok(expectedStyleMap.Normal);
	assert.ok(
		plan.request.expectedStyles.some(
			style =>
				style.styleId === 'StoHeading1' &&
				style.displayName === expectedStyleMap.StoHeading1,
		),
	);
	assert.ok(
		plan.request.expectedStyles.some(
			style =>
				style.styleId === 'TableCaption' &&
				style.displayName === expectedStyleMap.TableCaption,
		),
	);

	const defaultPlan = createWordAcceptancePlan(
		{
			inputDocx,
			acceptedDocx: 'accepted/final.docx',
			pdf: 'accepted/final.pdf',
			manifest: 'accepted/final.json',
		},
		{
			hostKind: 'windows',
			toHostPath: absolutePath => absolutePath,
			requestJsonPath,
		},
	);
	assert.equal(defaultPlan.hostKind, 'windows');
	assert.equal(defaultPlan.request.stylePreset, 'samara-template-2022');
	assert.deepEqual(
		defaultPlan.request.expectedStyles,
		Object.entries(expectedStyleMap).map(([styleId, displayName]) => ({
			styleId,
			displayName,
		})),
	);
	assert.equal(
		defaultPlan.request.acceptedDocx,
		path.resolve('accepted/final.docx'),
	);

	assert.throws(
		() =>
			createWordAcceptancePlan(
				{
					inputDocx,
					acceptedDocx: inputDocx,
				},
				{
					hostKind: 'wsl',
					toHostPath: fakeHostPath,
					requestJsonPath,
				},
			),
		/separate accepted DOCX/,
	);

	if (process.platform !== 'win32' && !process.platform.startsWith('linux')) {
		assert.throws(
			() => detectWordAcceptanceHost(),
			/Word acceptance requires WSL/,
		);
	}
	testPowerShellHashFallback();
	testPowerShellUsesShortWordStagingPaths();

	console.log('Word acceptance launcher tests passed.');
}

main();
