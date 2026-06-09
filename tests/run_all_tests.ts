import { spawnSync } from 'node:child_process';

const tsxCliPath = require.resolve('tsx/cli');

const tests = [
	['tests/source-preflight/run_source_preflight_tests.ts'],
	['tests/source-preflight/regression_checks.ts', 'example'],
	['tests/parser/run_parser_tests.ts'],
	['tests/validator/run_validator_tests.ts'],
	['tests/generator/run_generated_docx_validation.ts'],
	['tests/generator/title_page_metadata_test.ts'],
	['tests/scaffold/run_scaffold_tests.ts'],
	['tests/bibliography/bib-gost.test.ts'],
	['tests/generator/toc_regression.ts'],
	['tests/generator/run_generator_snapshot_test.ts'],
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
