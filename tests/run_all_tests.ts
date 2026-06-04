import { spawnSync } from 'node:child_process';

const tsxCliPath = require.resolve('tsx/cli');

const tests = [
	['tests/run_source_preflight_tests.ts'],
	['tests/regression_checks.ts', 'example'],
	['tests/run_parser_tests.ts'],
	['tests/run_validator_tests.ts'],
	['tests/run_generated_docx_validation.ts'],
	['tests/run_scaffold_tests.ts'],
	['tests/bib-gost.test.ts'],
	['tests/toc_regression.ts'],
	['tests/run_generator_snapshot_test.ts'],
];

for (const args of tests) {
	console.log(`\n> node ${tsxCliPath} ${args.join(' ')}`);
	const result = spawnSync(process.execPath, [tsxCliPath, ...args], {
		cwd: process.cwd(),
		stdio: 'inherit',
		shell: false,
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

console.log('\nAll tests passed.');
