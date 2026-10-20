import assert from 'node:assert/strict';

import { validateSourceFormulas } from '@/shared/lib/source-preflight/formula-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

function inspect(content: string): SourcePreflightIssue[] {
	const issues: SourcePreflightIssue[] = [];
	validateSourceFormulas('10_math.md', content, issues);
	return issues.filter(item => /where|consecutive-formula/u.test(item.code));
}
const where = 'где $x$ – величина.';
const valid = [
	`$$ x=y, $$\n\n${where}`,
	`$$ x=y, (@eq:test-label_2) $$\n\n${where}`,
	`$$\nx = y +\n    z,\n(@eq:multiline)\n$$\n\n${where}`,
	`$$ x=y, $$\r\n\r\nГде\t$x$ – величина.`,
	`$$ x=y, $$\n\nгде\n$x$ – величина.`,
	`$$ x=a/b, $$\n\n${where}`,
	`$$ x=y, $$\n\nгде $x$ – значение в усл. единицах.`,
	`$$ x=y, $$\n\nгде $x$ – значение в усл. ед.`,
	`$$ x=y, $$\n\nгде $x$ – первая; $y$ – вторая.`,
	`$$ x=y, $$\n\nгде $x$ – первая;\n$y$ – вторая.`,
	`$$ x=y, $$\n\nгде $x$ – первая;\n\n$y$ – вторая.`,
	`$$ x=y, $$\n\nгде $x$ – значение в усл.\nединицах.`,
	`$$ x=y. $$\n\nОбычный текст.\n\n${where}`,
	`$$ x=y. $$\n\nПример, где $x$ – величина.`,
	`$$ x=y. $$\n\nгде находится значение?`,
	`$$ x=y. $$\n\nгде-то есть значение.`,
	`$$ x=y $$\n\nНезависимое предложение.`,
	`$$ x=y, $$\n\n$$ a=b $$`,
	`$$ x=y; (@eq:first) $$\n\n$$ a=b. $$`,
	`$$ x=y $$\n\nТекст между формулами.\n\n$$ a=b $$`,
	'```md\n$$ x=y. $$\nгде: $x$ – ошибка\n```',
	'~~~md\n$$ x=y. $$\nгде: $x$ – ошибка\n~~~',
	'````md\n```\n$$ x=y. $$\nгде: $x$ – ошибка\n````',
	'`$$ x=y. $$ где: $x$ – ошибка`',
	'`` $$ x=y. $$ где: $x$ – ошибка ``',
	'    $$ x=y. $$\n    где: $x$ – ошибка',
	'<!-- $$ x=y. $$\nгде: $x$ – ошибка -->',
	'<pre>$$ x=y. $$\nгде: $x$ – ошибка</pre>',
	'<code>$$ x=y. $$\nгде: $x$ – ошибка</code>',
	'$$ x=y $$\n\n```md\nПример\n```\n\n' + where,
	'$$ x=y $$\n\n`промежуточный код`\n\n' + where,
	`$$ x=y, $$\n<!-- невидимый комментарий -->\n${where}`,
];
for (const source of valid) assert.deepEqual(inspect(source), [], source);

const invalid: [string, string, 'error' | 'warning'][] = [
	[`$$ x=y $$\n\n${where}`, 'formula-comma-before-where', 'error'],
	[
		'$$\nx=y\n(@eq:multiline)\n$$\n\n' + where,
		'formula-comma-before-where',
		'error',
	],
	[`$$ x=y. $$\n\n${where}`, 'formula-period-before-where', 'error'],
	[`$$ x=y; $$\n\n${where}`, 'formula-comma-before-where', 'error'],
	[`$$ x=y (@eq:one), $$\n\n${where}`, 'formula-comma-before-where', 'error'],
	[`$$ x=y, $$\n\nгде: $x$ – величина.`, 'where-colon', 'error'],
	[`$$ x=y, $$\n\nгде :\n$x$ – величина.`, 'where-colon', 'error'],
	[`$$ x=y $$\n\n$$ a=b $$`, 'consecutive-formula-punctuation', 'error'],
	[
		`$$ x=y. (@eq:first) $$\n\n$$ a=b $$`,
		'consecutive-formula-punctuation',
		'error',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – первая\n$y$ – вторая.`,
		'formula-where-definition-separator',
		'warning',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – первая, $y$ – вторая.`,
		'formula-where-definition-separator',
		'warning',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – первая $y$ – вторая.`,
		'formula-where-definition-separator',
		'warning',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – значение в усл. единицах`,
		'formula-where-final-period',
		'warning',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – первая в усл. ед.;\n$y$ – вторая`,
		'formula-where-final-period',
		'warning',
	],
	[
		`$$ x=y, $$\n\nгде $x$ – величина;`,
		'formula-where-final-period',
		'warning',
	],
];
for (const [source, code, severity] of invalid) {
	const issues = inspect(source);
	const item = issues.find(item => item.code === code);
	assert.ok(item, `${code}: ${JSON.stringify(issues)}\n${source}`);
	assert.equal(item.severity, severity);
	assert.equal(item.file, '10_math.md');
	assert.equal(item.line, /definition|final|colon/u.test(code) ? 3 : 1);
	assert.match(
		item.message,
		/Example:/u,
		'Every diagnostic includes a repair example',
	);
}
const linePreservation = inspect(
	'```md\n$$ literal $$\n```\n\n$$ x=y $$\n\n' + where,
);
assert.equal(linePreservation[0].line, 5);
console.log(
	`Formula source punctuation regressions: ${valid.length + invalid.length + 1} cases passed.`,
);
