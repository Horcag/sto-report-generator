import assert from 'node:assert/strict';

import {
	optionBoolean,
	optionNumber,
	optionString,
	parseArgs,
} from '@/app/cli-args';

const parsed = parseArgs([
	'generate',
	'reports/my report',
	'--renderer=wordcraft',
	'--strict-fonts',
	'--font-dir',
	String.raw`C:\Fonts With Spaces\Math`,
	'--output',
	'/tmp/report $name; $(literal).docx',
	'--year=2026',
	'--validate',
]);
assert.deepEqual(parsed.positionals, ['generate', 'reports/my report']);
assert.equal(optionString(parsed, 'renderer'), 'wordcraft');
assert.equal(
	optionString(parsed, 'font-dir'),
	String.raw`C:\Fonts With Spaces\Math`,
);
assert.equal(
	optionString(parsed, 'output'),
	'/tmp/report $name; $(literal).docx',
);
assert.equal(optionBoolean(parsed, 'strict-fonts'), true);
assert.equal(optionBoolean(parsed, 'validate'), true);
assert.equal(optionNumber(parsed, 'year'), 2026);
assert.equal(optionString(parsed, 'validate'), undefined);
assert.equal(optionString(parsed, 'missing'), undefined);
assert.equal(optionBoolean(parsed, 'missing'), undefined);
assert.equal(optionNumber(parsed, 'missing'), undefined);

// Keep the existing parser's value consumption and inline splitting rules.
const compatibility = parseArgs([
	'preview',
	'--value',
	'positional-looking-value',
	'--flag',
	'--repeat=first',
	'--repeat=last',
	'--empty=',
	'--equals=a=b',
	'--negative',
	'-2',
	'--false=false',
]);
assert.deepEqual(compatibility.positionals, ['preview']);
assert.equal(optionString(compatibility, 'value'), 'positional-looking-value');
assert.equal(optionBoolean(compatibility, 'flag'), true);
assert.equal(optionString(compatibility, 'repeat'), 'last');
assert.equal(optionString(compatibility, 'empty'), '');
assert.equal(optionNumber(compatibility, 'empty'), 0);
assert.equal(optionString(compatibility, 'equals'), 'a');
assert.equal(optionNumber(compatibility, 'negative'), -2);
assert.equal(optionBoolean(compatibility, 'false'), true);
compatibility.options.set('disabled', false);
assert.equal(optionBoolean(compatibility, 'disabled'), false);

for (const value of ['NaN', 'Infinity', 'text']) {
	assert.throws(
		() => optionNumber(parseArgs([`--year=${value}`]), 'year'),
		/--year must be a number\./,
	);
}
assert.deepEqual(parseArgs([]).positionals, []);
assert.equal(parseArgs([]).options.size, 0);
assert.equal(
	optionBoolean(
		parseArgs(['accept-word', 'input.docx', '--background-only']),
		'background-only',
	),
	true,
);

console.log(
	'CLI argument parser tests passed: options, positionals, literal paths and compatibility.',
);
