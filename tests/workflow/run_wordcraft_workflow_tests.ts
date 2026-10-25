import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateReport } from '@/app/report-workflow';
import { resolveReportConfig } from '@/shared/lib/report-config';

const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), 'sto-wordcraft-workflow-'),
);
const tsx = require.resolve('tsx/cli');
// Nested CLI processes include instrumented startup and coverage flushing.
const cliTimeout = 90_000;
let cases = 0;

function cli(args: string[]) {
	const result = spawnSync(process.execPath, [tsx, 'src/index.ts', ...args], {
		cwd: process.cwd(),
		encoding: 'utf8',
		shell: false,
		timeout: cliTimeout,
	});
	if (result.error) throw result.error;
	return result;
}

async function main(): Promise<void> {
	try {
		const report = path.join(directory, 'example');
		fs.cpSync('example', report, { recursive: true });
		const configPath = path.join(report, 'report.config.json');
		fs.writeFileSync(configPath, JSON.stringify({ renderer: 'wordcraft' }));
		const resolved = resolveReportConfig(report);
		assert.equal(resolved.config.renderer, 'wordcraft');
		assert.equal(resolved.config.postBuild.enabled, false);
		assert.deepEqual(resolved.diagnostics, []);
		cases++;

		fs.writeFileSync(
			configPath,
			JSON.stringify({
				renderer: 'wordcraft',
				postBuild: { enabled: true },
			}),
		);
		assert.ok(
			resolveReportConfig(report).diagnostics.some(
				issue => issue.code === 'report-config-renderer-conflict',
			),
		);
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				renderer: 'wordcraft',
				postBuild: { enabled: false },
			}),
		);
		assert.deepEqual(resolveReportConfig(report).diagnostics, []);
		cases++;

		await assert.rejects(
			generateReport({
				reportDir: report,
				renderer: 'wordcraft',
				postBuild: true,
			}),
			/Word COM post-build requires/,
		);
		await assert.rejects(
			generateReport({ reportDir: report, postBuild: true }),
			/Word COM post-build requires/,
		);
		await assert.rejects(
			generateReport({
				reportDir: report,
				renderer: 'portable',
				outputPdf: 'other.pdf',
			}),
			/PDF overrides require/,
		);
		cases++;

		const missingCli = path.join(directory, 'missing-wordcraft');
		await assert.rejects(
			generateReport({
				reportDir: report,
				wordcraftExecutable: missingCli,
				validate: true,
			}),
			/Wordcraft.*failed/,
		);
		assert.ok(fs.existsSync(path.join(report, 'build/example.docx')));
		assert.ok(
			!fs.existsSync(path.join(report, 'build/example.wordcraft.pdf')),
		);
		cases++;

		const generate = cli([
			'generate',
			report,
			'--renderer',
			'wordcraft',
			'--wordcraft',
			missingCli,
		]);
		assert.notEqual(generate.status, 0);
		assert.match(generate.stderr, /Wordcraft.*failed/);
		const audit = cli([
			'audit',
			report,
			'--renderer',
			'wordcraft',
			'--wordcraft',
			missingCli,
		]);
		assert.notEqual(audit.status, 0);
		assert.match(audit.stderr, /Wordcraft.*failed/);
		cases++;

		const input = path.join(report, 'build/example.docx');
		const preview = cli([
			'preview',
			input,
			'--renderer',
			'wordcraft',
			'--wordcraft',
			missingCli,
		]);
		assert.notEqual(preview.status, 0);
		assert.match(preview.stderr, /Wordcraft.*failed/);
		const badPreview = cli(['preview', input, '--renderer', 'portable']);
		assert.match(badPreview.stderr, /Preview renderers/);
		const conflictingPreview = cli([
			'preview',
			input,
			'--renderer',
			'wordcraft',
			'--soffice',
			'soffice',
		]);
		assert.match(conflictingPreview.stderr, /--soffice requires/);
		cases++;

		const help = cli(['help']);
		assert.equal(help.status, 0, help.stderr);
		assert.match(help.stdout, /portable\|word\|wordcraft/);
		assert.match(help.stdout, /--wordcraft/);
		assert.match(help.stdout, /wordcraft-cli 0\.10\.0/);
		const conflict = cli([
			'generate',
			report,
			'--renderer',
			'wordcraft',
			'--post-build',
		]);
		assert.match(conflict.stderr, /legacy Word COM renderer path/);
		const doctor = spawnSync(
			process.execPath,
			[tsx, 'src/index.ts', 'doctor'],
			{
				encoding: 'utf8',
				shell: false,
				timeout: cliTimeout,
				env: {
					...process.env,
					WORDCRAFT_CLI: 'sto-missing-wordcraft-cli',
				},
			},
		);
		if (doctor.error) throw doctor.error;
		assert.match(doctor.stdout, /Wordcraft renderer: unavailable/);
		assert.match(doctor.stdout, /requires wordcraft-cli 0\.10\.0/);
		assert.match(doctor.stdout, /ENOENT/);
		cases++;
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
	console.log(`Wordcraft workflow tests passed (${cases} cases).`);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
