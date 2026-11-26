import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scaffoldReport } from '@/app/report-scaffold';
import { DEFAULT_STO_STYLE_PRESET, StoStylePreset } from '@/shared/config';
import { isStrictStoDocx } from '@/shared/lib/docx/strict-sto';
import { resolveReportConfig } from '@/shared/lib/report-config';

const tsx = require.resolve('tsx/cli');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-strict-config-'));

function cli(args: string[], passed = true): string {
	const result = spawnSync(process.execPath, [tsx, 'src/index.ts', ...args], {
		encoding: 'utf8',
		timeout: 90_000,
		maxBuffer: 1024 * 1024,
	});
	assert.equal(result.error, undefined);
	if (passed) {
		assert.equal(result.status, 0, result.stdout + result.stderr);
	} else {
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
	}
	return result.stdout + result.stderr;
}

try {
	const configPath = path.join(root, 'report.config.json');
	assert.equal(
		resolveReportConfig(root).config.stylePreset,
		DEFAULT_STO_STYLE_PRESET,
	);
	assert.equal(resolveReportConfig(root).config.preflight.strict, false);
	fs.writeFileSync(configPath, JSON.stringify({ stylePreset: 'sto-strict' }));
	assert.equal(resolveReportConfig(root).config.stylePreset, 'sto-strict');
	assert.deepEqual(resolveReportConfig(root).diagnostics, []);
	assert.equal(resolveReportConfig(root).config.preflight.strict, false);
	assert.equal(
		resolveReportConfig(root, { stylePreset: 'default' }).config
			.stylePreset,
		'default',
	);
	assert.equal(
		resolveReportConfig(root, { strict: true }).config.stylePreset,
		'sto-strict',
	);
	assert.equal(
		resolveReportConfig(root, { strict: true }).config.preflight.strict,
		true,
	);
	assert.throws(
		() =>
			resolveReportConfig(root, {
				stylePreset: 'invalid' as StoStylePreset,
			}),
		/Unknown style preset/,
	);
	fs.writeFileSync(configPath, JSON.stringify({ stylePreset: 'invalid' }));
	assert.ok(
		resolveReportConfig(root).diagnostics.some(
			item => item.code === 'report-config-unknown-style-preset',
		),
	);

	const report = path.join(root, 'report');
	scaffoldReport({
		slug: 'strict-test',
		dir: report,
		profile: 'lab',
		title: 'Тест оформления',
		studentName: 'Тестовый Студент',
		supervisorName: 'Тестовый Преподаватель',
		initGit: false,
	});
	const reportConfigPath = path.join(report, 'report.config.json');
	const reportConfig = JSON.parse(fs.readFileSync(reportConfigPath, 'utf8'));
	reportConfig.stylePreset = 'default';
	reportConfig.validate = { enabled: false, unpackDir: 'unpacked' };
	fs.writeFileSync(reportConfigPath, JSON.stringify(reportConfig));
	cli(['check', report, '--style-preset', 'sto-strict']);
	for (const command of ['build', 'generate', 'audit', 'check']) {
		assert.match(
			cli([command, report, '--style-preset', 'invalid'], false),
			/Supported style presets:.*sto-strict/,
		);
	}
	assert.match(
		cli(['check', report, '--style-preset'], false),
		/requires a preset name/,
	);
	const warningSource = path.join(report, '50_warning.md');
	fs.writeFileSync(warningSource, String.raw`Значение $2\cdot x$.`);
	assert.match(
		cli(['check', report, '--style-preset', 'sto-strict']),
		/WARN:/,
	);
	assert.match(
		cli(
			['check', report, '--style-preset', 'sto-strict', '--strict'],
			false,
		),
		/WARN:/,
	);
	fs.rmSync(warningSource);
	const ordinaryOutput = path.join(root, 'ordinary.docx');
	cli([
		'generate',
		report,
		'--output',
		ordinaryOutput,
		'--renderer',
		'portable',
	]);
	assert.equal(isStrictStoDocx(ordinaryOutput), false);
	for (const command of ['generate', 'audit']) {
		const output = path.join(root, `${command}.docx`);
		cli([
			command,
			report,
			'--output',
			output,
			'--renderer',
			'portable',
			'--style-preset',
			'sto-strict',
		]);
		assert.equal(
			isStrictStoDocx(output),
			true,
			`${command} must propagate the CLI preset`,
		);
	}
	const markdown = path.join(root, 'input.md');
	fs.writeFileSync(
		markdown,
		'---\nstylePreset: sto-strict\n---\n\nТестовый текст.\n',
	);
	const inherited = path.join(root, 'metadata.docx');
	cli(['build', markdown, inherited]);
	assert.equal(isStrictStoDocx(inherited), true);
	for (const prefix of [['build', markdown], [markdown]]) {
		const output = path.join(
			root,
			`${prefix.length === 2 ? 'build' : 'legacy'}.docx`,
		);
		cli([...prefix, output, '--style-preset', 'default']);
		assert.equal(
			isStrictStoDocx(output),
			false,
			'CLI default must override strict metadata',
		);
		cli([...prefix, output, '--style-preset', 'sto-strict']);
		assert.equal(isStrictStoDocx(output), true);
	}
	console.log(
		'Strict preset config, CLI propagation, metadata precedence and default preservation passed.',
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
