import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

import { generateReport } from '@/app/report-workflow';

const tsxCliPath = require.resolve('tsx/cli');
const tempRoot = path.join(process.cwd(), '.agent-work', 'portability-tests');
const tempReport = path.join(tempRoot, 'example');

function runCli(args: string[]) {
	return spawnSync(process.execPath, [tsxCliPath, 'src/index.ts', ...args], {
		cwd: process.cwd(),
		encoding: 'utf8',
		shell: false,
	});
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	fs.cpSync('example', tempReport, { recursive: true });

	const portableResult = await generateReport({
		reportDir: tempReport,
		renderer: 'portable',
		validate: true,
	});
	assert.equal(portableResult.renderer, 'portable');
	assert.equal(portableResult.postBuildRan, false);
	assert.ok(
		portableResult.validation?.every(result => result.passed),
		'portable renderer must build and validate DOCX without Word post-build',
	);

	const doctor = runCli(['doctor']);
	assert.equal(doctor.status, 0, doctor.stderr);
	assert.match(doctor.stdout, /Portable renderer: available/);
	assert.match(doctor.stdout, /Word renderer: (optional|unavailable)/);
	assert.doesNotMatch(doctor.stdout, /\/home\/|[A-Z]:\\/);

	const auditDefault = runCli(['audit', tempReport]);
	assert.equal(auditDefault.status, 0, auditDefault.stderr);
	assert.match(auditDefault.stdout, /Renderer: portable/);
	assert.match(auditDefault.stdout, /Post-build: skipped/);
	assert.match(auditDefault.stdout, /DOCX validation passed/);

	const auditPortable = runCli([
		'audit',
		tempReport,
		'--renderer',
		'portable',
	]);
	assert.equal(auditPortable.status, 0, auditPortable.stderr);
	assert.match(auditPortable.stdout, /Renderer: portable/);
	assert.match(auditPortable.stdout, /Post-build: skipped/);
	assert.match(auditPortable.stdout, /DOCX validation passed/);

	const rendererConflict = runCli([
		'generate',
		tempReport,
		'--renderer',
		'portable',
		'--post-build',
	]);
	assert.notEqual(rendererConflict.status, 0);
	assert.match(rendererConflict.stderr, /legacy Word COM renderer path/);

	if (process.platform !== 'win32') {
		mock.method(os, 'release', () => 'plain-linux');
		const wordResult = await generateReport({
			reportDir: tempReport,
			renderer: 'word',
		}).then(
			() => 'resolved',
			(error: unknown) =>
				error instanceof Error ? error.message : String(error),
		);
		assert.match(wordResult, /Word acceptance requires WSL/);
	}

	mock.restoreAll();
	fs.rmSync(tempRoot, { recursive: true, force: true });
	console.log('Portability workflow tests passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
