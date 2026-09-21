import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { coverageFailures, parseLcov, readCoverageMinimums } from './lcov-gate';

const projectRoot = resolve(__dirname, '../..');
const c8CliPath = require.resolve('c8/bin/c8.js');
const tsxCliPath = require.resolve('tsx/cli');
const configPath = resolve(projectRoot, 'scripts/quality/c8.config.json');
const baselinePath = resolve(
	projectRoot,
	'scripts/quality/coverage-baseline.json',
);
const reportPath = resolve(projectRoot, 'coverage/lcov.info');

const result = spawnSync(
	process.execPath,
	[
		c8CliPath,
		'--config',
		configPath,
		'--reports-dir',
		resolve(projectRoot, 'coverage'),
		process.execPath,
		tsxCliPath,
		'tests/run_all_tests.ts',
	],
	{ cwd: projectRoot, stdio: 'inherit', shell: false },
);

if (result.error) {
	throw result.error;
}
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
if (!existsSync(reportPath)) {
	throw new Error(`Coverage report was not generated: ${reportPath}`);
}

const summary = parseLcov(readFileSync(reportPath, 'utf8'));
const failures = coverageFailures(summary, readCoverageMinimums(baselinePath));
if (failures.length > 0) {
	throw new Error(`Coverage gate failed:\n${failures.join('\n')}`);
}

console.log(`Coverage gate passed: ${reportPath}`);
