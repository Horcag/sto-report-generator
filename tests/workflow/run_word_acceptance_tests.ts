import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	createWordAcceptancePlan,
	detectWordAcceptanceHost,
	runWordAcceptance,
	WORD_ACCEPTANCE_OVERALL_TIMEOUT_MS,
	WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
	WORD_ACCEPTANCE_STAGE_TIMEOUT_MS,
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

function testPowerShellLicenseStatusParsing(): void {
	const executable = 'powershell.exe';
	const availability = spawnSync(executable, [
		'-NoProfile',
		'-Command',
		'exit 0',
	]);
	if (availability.error) return;

	mkdirSync(path.resolve('.agent-work'), { recursive: true });
	const temporaryDirectory = mkdtempSync(
		path.resolve('.agent-work', 'word-license-test-'),
	);
	const statusPath = path.join(temporaryDirectory, 'status.txt');
	const vnextStatusPath = path.join(temporaryDirectory, 'vnext-status.txt');
	const scriptPath = path.resolve('scripts', 'check_word_license.ps1');
	const run = (status: string, vnextStatus?: string) => {
		writeFileSync(statusPath, status, 'utf8');
		if (vnextStatus !== undefined) {
			writeFileSync(vnextStatusPath, vnextStatus, 'utf8');
		}
		const args = [
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			toPowerShellPath(scriptPath),
			'-StatusTextPath',
			toPowerShellPath(statusPath),
		];
		if (vnextStatus !== undefined) {
			args.push(
				'-VNextStatusTextPath',
				toPowerShellPath(vnextStatusPath),
			);
		}
		return spawnSync(executable, args, { encoding: 'utf8' });
	};
	const legacyVNextStatus = `
========== Mode per ProductReleaseId ==========
o365proplusretail = Legacy

========== vNext licenses found ==========
No licenses found.
`;

	try {
		const licensed = run(
			`
---------------------------------------
LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription1 edition
LICENSE STATUS:  ---NOTIFICATIONS---
ERROR CODE: 0xC004F009
---------------------------------------
LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription2 edition
LICENSE STATUS:  ---LICENSED---
`,
			legacyVNextStatus,
		);
		assert.equal(licensed.status, 0, licensed.stderr);
		assert.match(licensed.stdout, /LICENSED/);

		const unlicensed = run(
			`
LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription2 edition
LICENSE STATUS:  ---NOTIFICATIONS---
ERROR CODE: 0xC004F009
`,
			legacyVNextStatus,
		);
		assert.notEqual(unlicensed.status, 0);
		assert.match(
			`${unlicensed.stdout}\n${unlicensed.stderr}`,
			/activated legacy Office license.*NOTIFICATIONS.*0xC004F009/s,
		);

		const vnextLicensed = run(
			`LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription2 edition
LICENSE STATUS:  ---NOTIFICATIONS---
ERROR CODE: 0xC004F009`,
			`o365proplusretail = vNext
{
    "Version": "1.0",
    "Type": "User",
    "Product": "O365ProPlusRetail",
    "LicenseState": "Licensed"
}`,
		);
		assert.equal(vnextLicensed.status, 0, vnextLicensed.stderr);
		assert.match(vnextLicensed.stdout, /LICENSED \(vNext\/device\)/);

		const vnextUnlicensed = run(
			`LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription2 edition
LICENSE STATUS:  ---LICENSED---`,
			`o365proplusretail = vNext
{
    "Version": "1.0",
    "Type": "User",
    "Product": "O365ProPlusRetail",
    "LicenseState": "RFM"
}`,
		);
		assert.notEqual(vnextUnlicensed.status, 0);
		assert.match(
			`${vnextUnlicensed.stdout}\n${vnextUnlicensed.stderr}`,
			/Current vNext status: RFM/,
		);

		const staleVnextLicense = run(
			`LICENSE NAME: Office 16, Office16O365ProPlusR_Subscription2 edition
LICENSE STATUS:  ---NOTIFICATIONS---
ERROR CODE: 0xC004F009`,
			`o365proplusretail = Legacy
{
    "Version": "1.0",
    "Type": "User",
    "Product": "O365ProPlusRetail",
    "LicenseState": "Licensed"
}`,
		);
		assert.notEqual(staleVnextLicense.status, 0);
		assert.match(
			`${staleVnextLicense.stdout}\n${staleVnextLicense.stderr}`,
			/activated legacy Office license.*NOTIFICATIONS.*0xC004F009/s,
		);

		for (const licenseName of [
			'Office 16, Office16O365BusinessR_Subscription1 edition',
			'Office 21, Office21Standard2021VL_KMS_Client edition',
			'Office 21, Office21Word2021VL_KMS_Client edition',
		]) {
			const supportedLegacyEdition = run(
				`LICENSE NAME: ${licenseName}\nLICENSE STATUS:  ---LICENSED---`,
				'office21standard2021volume = Legacy',
			);
			assert.equal(
				supportedLegacyEdition.status,
				0,
				supportedLegacyEdition.stderr,
			);
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
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
	assert.ok(
		script.indexOf('$document.ExportAsFixedFormat') <
			script.indexOf('$styleChecks = Get-StyleChecks'),
		'Word style COM lookups must happen after PDF export',
	);
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
	assert.match(script, /GetWindowThreadProcessId/);
	assert.match(script, /reused a pre-existing automation process/);
	assert.match(script, /Set-DiagnosticStage "document\.pdf-export"/);
	assert.match(script, /Set-DiagnosticFinal "failed"/);
	assert.doesNotMatch(script, /\$Word\.FontNames/);
	assert.match(script, /check_word_license\.ps1/);
	const licenseScript = readFileSync(
		path.resolve('scripts', 'check_word_license.ps1'),
		'utf8',
	);
	assert.doesNotMatch(
		licenseScript,
		/^\s*exit\b/m,
		'the nested license preflight must return without terminating its caller',
	);
	assert.ok(
		script.indexOf('check_word_license.ps1') <
			script.indexOf('New-Object -ComObject Word.Application'),
		'Office licensing must be checked before starting Word COM',
	);
	assert.match(script, /\[int\]\$field\.Type -ne \$WdFieldTOC/);
	assert.match(
		script,
		/foreach \(\$previousOutput in @\(\$request\.acceptedDocx, \$request\.pdf, \$request\.manifest\)\)/,
	);
	assert.match(script, /Move-Item -LiteralPath \$temporaryPath/);
	assert.match(
		script,
		/for \(\$attempt = 1; \$attempt -le 4; \$attempt\+\+\)/,
	);
	assert.match(script, /\$operationError = \$_/);
	assert.match(script, /\$secondaryErrors -join \[Environment\]::NewLine/);
	assert.doesNotMatch(script, /Write-Warning \$cleanupMessage/);
}

async function main(): Promise<void> {
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
			runId: 'test-run-id',
			startedAt: '2026-09-22T00:00:00.000Z',
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
	assert.equal(plan.request.runId, 'test-run-id');
	assert.equal(plan.request.startedAt, '2026-09-22T00:00:00.000Z');
	assert.equal(WORD_ACCEPTANCE_STAGE_TIMEOUT_MS, 120_000);
	assert.equal(WORD_ACCEPTANCE_OVERALL_TIMEOUT_MS, 300_000);
	assert.equal(
		plan.request.runnerPidPath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'runner.pid')}`,
	);
	assert.equal(
		plan.request.wordPidPath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'word.pid')}`,
	);
	assert.equal(
		plan.request.wordPidsBeforePath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'word-pids-before.json')}`,
	);
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
	assert.equal(
		plan.request.diagnostics,
		`WIN:${path.resolve(inputDocx).replace(/\.docx$/, '.acceptance.diagnostics.json')}`,
	);
	assert.equal(
		plan.diagnosticsPath,
		path
			.resolve(inputDocx)
			.replace(/\.docx$/, '.acceptance.diagnostics.json'),
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
			diagnostics: 'accepted/final.diagnostics.json',
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
	assert.equal(
		defaultPlan.diagnosticsPath,
		path.resolve('accepted/final.diagnostics.json'),
	);
	assert.equal(
		defaultPlan.request.diagnostics,
		path.resolve('accepted/final.diagnostics.json'),
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
	assert.throws(
		() =>
			createWordAcceptancePlan(
				{
					inputDocx,
					stylePreset: 'unsupported' as never,
				},
				{
					hostKind: 'wsl',
					toHostPath: fakeHostPath,
					requestJsonPath,
				},
			),
		/Supported style presets/,
	);

	if (process.platform === 'win32') {
		assert.equal(detectWordAcceptanceHost(), 'windows');
	} else if (
		process.platform === 'linux' &&
		(os.release().toLowerCase().includes('microsoft') ||
			os.release().toLowerCase().includes('wsl'))
	) {
		assert.equal(detectWordAcceptanceHost(), 'wsl');
	} else {
		assert.throws(
			() => detectWordAcceptanceHost(),
			/Word acceptance requires WSL/,
		);
		await assert.rejects(
			runWordAcceptance({ inputDocx: path.resolve('package.json') }),
			/Word acceptance requires WSL/,
		);
	}
	await assert.rejects(
		runWordAcceptance({ inputDocx: '.agent-work/does-not-exist.docx' }),
		/DOCX file not found/,
	);
	testPowerShellHashFallback();
	testPowerShellLicenseStatusParsing();
	testPowerShellUsesShortWordStagingPaths();
	const launcher = readFileSync(
		path.resolve('src', 'app', 'word-acceptance.ts'),
		'utf8',
	);
	assert.match(launcher, /WORD_ACCEPTANCE_STAGE_TIMEOUT_MS/);
	assert.match(launcher, /stop_word_acceptance\.ps1/);
	assert.match(launcher, /status: 'timed_out'/);
	const cleanupScript = readFileSync(
		path.resolve('scripts', 'stop_word_acceptance.ps1'),
		'utf8',
	);
	assert.match(cleanupScript, /Get-CimInstance Win32_Process/);
	assert.match(cleanupScript, /Refusing to stop PID/);
	assert.match(cleanupScript, /\/Automation/);
	assert.match(cleanupScript, /Embedding/);

	console.log('Word acceptance launcher tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
