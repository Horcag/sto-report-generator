import assert from 'node:assert/strict';

import {
	coverageFailures,
	parseLcov,
	percentage,
} from '../../scripts/quality/lcov-gate';

function expectThrows(action: () => unknown, message: string): void {
	assert.throws(action, new RegExp(message));
}

const report = [
	'TN:',
	'SF:src/one.ts',
	'FNF:4',
	'FNH:3',
	'BRF:6',
	'BRH:4',
	'LF:10',
	'LH:8',
	'end_of_record',
	'SF:src/two.ts',
	'FNF:2',
	'FNH:2',
	'BRF:4',
	'BRH:3',
	'LF:5',
	'LH:5',
	'end_of_record',
].join('\n');

const summary = parseLcov(report);
assert.deepEqual(summary, {
	lines: { covered: 13, found: 15 },
	functions: { covered: 5, found: 6 },
	branches: { covered: 7, found: 10 },
});
assert.equal(percentage(summary.lines), 86.66666666666667);
assert.deepEqual(
	coverageFailures(summary, { lines: 86, functions: 83, branches: 70 }),
	[],
);
assert.deepEqual(
	coverageFailures(summary, { lines: 87, functions: 84, branches: 71 }),
	[
		'lines: 86.67% is below 87.00%',
		'functions: 83.33% is below 84.00%',
		'branches: 70.00% is below 71.00%',
	],
);

expectThrows(
	() => parseLcov('TN:\nend_of_record\n'),
	'contains no source files',
);
expectThrows(
	() => parseLcov('SF:src/one.ts\nLF:0\nLH:0\nFNF:1\nFNH:1\nBRF:1\nBRH:1\n'),
	'no lines coverage data',
);
expectThrows(
	() => coverageFailures(summary, { lines: 101, functions: 0, branches: 0 }),
	'Invalid lines coverage minimum',
);

console.log('LCOV gate tests passed.');
