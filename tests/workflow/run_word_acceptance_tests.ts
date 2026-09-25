import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
	createWordAcceptancePlan,
	detectWordAcceptanceHost,
	WORD_ACCEPTANCE_BACKGROUND_TIMEOUT_MS,
	WORD_ACCEPTANCE_REQUEST_SCHEMA_VERSION,
	WORD_ACCEPTANCE_TIMEOUT_MS,
} from '@/app/word-acceptance';
import { getStoStylePresetDisplayNames } from '@/shared/config';

import {
	testPowerShellHashFallback,
	toPowerShellPath,
} from './word_acceptance_hash_test';

function fakeHostPath(absolutePath: string): string {
	return `WIN:${absolutePath}`;
}

function testTablePaginationPowerShell(): void {
	const probe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']);
	if (probe.error) return;
	const result = spawnSync('pwsh', [
		'-NoProfile',
		'-File',
		path.resolve('tests', 'workflow', 'word_table_pagination_test.ps1'),
	]);
	assert.equal(result.status, 0, String(result.stderr || result.stdout));
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
	assert.doesNotMatch(script, /Lock-DocumentFieldsForPdfExport/);
	assert.doesNotMatch(script, /\$field\.Locked = \$true/);
	assert.match(script, /Add-Type -Path.*word_pdf_export\.cs/);
	assert.match(script, /\[WordAcceptance\.PdfExporter\]::Export/);
	assert.doesNotMatch(script, /\$document\.ExportAsFixedFormat\(/);
	assert.ok(
		script.indexOf('$word.Documents.Open($stagedAcceptedDocx') <
			script.indexOf('[WordAcceptance.PdfExporter]::Export'),
		'PDF export must use a freshly reopened accepted DOCX',
	);
	assert.ok(
		script.indexOf('[WordAcceptance.PdfExporter]::Export') <
			script.indexOf('$styleChecks = Get-StyleChecks'),
		'Word style COM lookups must happen after PDF export',
	);
	assert.match(script, /"staging\.path"/);
	assert.match(script, /"word-process\.json"/);
	assert.match(script, /\$Document\.Styles\.Item\(\[string\]\$DisplayName\)/);
	assert.doesNotMatch(
		script,
		/foreach \(\$style in @\(\$Document\.Styles\)\)/,
	);
	assert.match(script, /System\.Drawing\.Text\.InstalledFontCollection/);
	assert.doesNotMatch(script, /\$Word\.FontNames/);
	assert.match(script, /Get-LicenseDiagnostic/);
	const licenseScript = readFileSync(
		path.resolve('scripts', 'check_word_license.ps1'),
		'utf8',
	);
	assert.doesNotMatch(
		licenseScript,
		/^\s*exit\b/m,
		'the nested license preflight must return without terminating its caller',
	);
	assert.match(
		script,
		/capability verification will continue/,
		'Office licensing diagnostics must not block capability verification',
	);
	assert.match(script, /interactionMode -eq "interactive"/);
	assert.match(script, /GetWindowThreadProcessId/);
	assert.match(script, /COM reused a pre-existing Word process/);
	assert.match(script, /if \(\$ownsWordProcess\)/);
	assert.match(script, /Assert-OutputFile \$request\.pdf "PDF"/);
	assert.match(script, /renderer = "word-desktop-interactive"/);
	assert.match(script, /Get-WordPrinterDiagnostic/);
	assert.match(script, /selectedForWord = if \(\$defaultPrinter\)/);
	assert.doesNotMatch(script, /Set-SafeWordLayoutPrinter/);
	assert.match(script, /SetDefaultPrinter/);
	assert.match(script, /temporarilyChangedSystemDefault/);
	assert.match(script, /LegacyDefaultPrinterMode/);
	assert.match(script, /legacyDefaultPrinterModePresent/);
	assert.match(script, /Restore-DefaultPrinter/);
	assert.match(script, /ActiveWindow\.Panes\(1\)\.Pages\.Count/);
	assert.match(script, /Set-ReferatStatistics \$document \$request/);
	assert.match(
		script,
		/Referat statistic placeholders remain after Word replacement/,
	);
	assert.match(
		script,
		/Accepted DOCX still contains referat statistic placeholders/,
	);
	assert.match(script, /referatStatistics = \[ordered\]@\{/);
	assert.doesNotMatch(script, /\.ComputeStatistics\(/);
	assert.match(script, /\[int\]\$field\.Type -ne \$WdFieldTOC/);
	assert.match(
		script,
		/foreach \(\$previousOutput in @\(\$request\.acceptedDocx, \$request\.pdf, \$request\.manifest\)\)/,
	);
	assert.match(script, /Move-Item -LiteralPath \$temporaryPath/);
	assert.match(script, /\$operationError = \$_/);
	assert.match(script, /\$secondaryErrors -join \[Environment\]::NewLine/);
	assert.doesNotMatch(script, /Write-Warning \$cleanupMessage/);
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
	assert.equal(
		plan.scriptPath,
		path.resolve(__dirname, '..', '..', 'scripts', 'word_acceptance.ps1'),
	);
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
	assert.equal(WORD_ACCEPTANCE_TIMEOUT_MS, 180_000);
	assert.equal(WORD_ACCEPTANCE_BACKGROUND_TIMEOUT_MS, 45_000);
	assert.equal(plan.request.interactionMode, 'background');
	assert.deepEqual(plan.request.attemptedModes, ['background']);
	assert.deepEqual(plan.request.statisticReplacements, {});
	assert.deepEqual(plan.request.statisticCounts, {
		figures: 0,
		tables: 0,
		sources: 0,
		appendices: 0,
	});
	assert.equal(
		plan.request.runnerPidPath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'runner.pid')}`,
	);
	assert.equal(
		plan.request.wordPidPath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'word.pid')}`,
	);
	assert.equal(
		plan.request.printerStatePath,
		`WIN:${path.join(path.dirname(requestJsonPath), 'printer-state.txt')}`,
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
	testTablePaginationPowerShell();
	testPowerShellLicenseStatusParsing();
	testPowerShellUsesShortWordStagingPaths();
	const launcher = readFileSync(
		path.resolve('src', 'app', 'word-acceptance.ts'),
		'utf8',
	);
	assert.match(launcher, /WORD_ACCEPTANCE_TIMEOUT_MS,/);
	assert.match(launcher, /WORD_ACCEPTANCE_BACKGROUND_TIMEOUT_MS/);
	assert.match(launcher, /retrying interactively/);
	assert.match(
		launcher,
		/windowsHide: plan\.request\.interactionMode === 'background'/,
	);
	assert.match(launcher, /result\.stdout,[\s\S]*result\.stderr,/);
	assert.match(launcher, /stop_word_acceptance\.ps1/);
	assert.match(launcher, /writeWordAcceptanceFailureManifest/);
	assert.match(launcher, /pageCountBeforeFailure/);
	assert.match(launcher, /stage:[\s\S]*'exportPdf'/);
	const cleanupScript = readFileSync(
		path.resolve('scripts', 'stop_word_acceptance.ps1'),
		'utf8',
	);
	assert.match(cleanupScript, /Get-CimInstance Win32_Process/);
	assert.match(cleanupScript, /Refusing to stop PID/);
	assert.match(cleanupScript, /attempt -le 100/);
	assert.match(cleanupScript, /Restore-DefaultPrinter/);
	assert.match(cleanupScript, /LegacyDefaultPrinterMode/);
	assert.match(cleanupScript, /Get-WordPreservationMessage/);
	assert.match(cleanupScript, /GetVisibleTopLevelWindowTitles/);
	assert.match(cleanupScript, /unexpected window\(s\)/);
	assert.match(cleanupScript, /The user may have opened another document/);
	assert.ok(
		cleanupScript.indexOf('wordPidPath') <
			cleanupScript.indexOf('printerStatePath'),
		'cleanup must stop Word before restoring the user printer',
	);
	assert.ok(
		cleanupScript.indexOf('wordPidPath') <
			cleanupScript.indexOf('runnerPidPath'),
		'cleanup must stop the owned Word process before its PowerShell controller',
	);

	console.log('Word acceptance launcher tests passed.');
}

main();
