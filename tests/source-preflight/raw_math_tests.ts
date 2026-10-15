import assert from 'node:assert/strict';

import { validateRawMath } from '@/shared/lib/source-preflight/raw-math-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

function codes(content: string): string[] {
	const issues: SourcePreflightIssue[] = [];
	validateRawMath('report.md', content, issues);
	return issues.map(item => item.code);
}

function issues(content: string): SourcePreflightIssue[] {
	const result: SourcePreflightIssue[] = [];
	validateRawMath('report.md', content, result);
	return result;
}

export function runRawMathTests(): void {
	assert.deepEqual(codes('Параметр t_s и коэффициент a_cp.'), [
		'raw-math-identifier',
		'raw-math-identifier',
	]);
	assert.deepEqual(codes('Параметр a_{cp} и степень x^2.'), [
		'raw-math-identifier',
		'raw-math-identifier',
	]);
	assert.deepEqual(codes('| Значение |\n|---|\n| t_s и 12 / 3 |'), [
		'raw-math-identifier',
		'raw-math-slash-fraction',
	]);
	assert.deepEqual(
		codes('Доля 12 / 3.\n\n`a_cp` и `$t_s$`.\n\n```py\na_cp = 12 / 3\n```'),
		['raw-math-slash-fraction'],
	);
	assert.deepEqual(
		codes(
			'Формулы $t_s$, $a_{cp}$ и $\\frac{1}{2}$.\n\nПуть src/a_b.ts, /home/user/a_b.txt, URL https://host/a_b.',
		),
		[],
	);
	assert.deepEqual(codes('Объем кг/м^3; структура x_axis;'), []);
	assert.deepEqual(
		codes('Параметр t_s обсуждается рядом с файлом report.txt.'),
		['raw-math-identifier'],
	);
	assert.deepEqual(codes('Дата 15/10/2026.'), []);
	assert.deepEqual(codes('~~~text\nt_s = 1\n~~~'), []);
	assert.deepEqual(codes('---\nvalue: t_s\n---\n\nТекст.'), []);

	const fencedExamples = [
		'   ```c\n   t_s = 12 / 3;\n   ```',
		'````text\n```\nt_s = 12 / 3\n```\n````',
		'~~~text\n```\nt_s = 12 / 3\n```\n~~~',
		'```md\n| t_s | 12 / 3 |\n```',
	].join('\n\n');
	assert.deepEqual(codes(fencedExamples), []);

	const withAfterFenceContent = [
		fencedExamples,
		'',
		'Outside code: t_s.',
		'',
		'| Значение |',
		'|---|',
		'| t_s и 12 / 3 |',
	].join('\n');
	assert.deepEqual(
		issues(withAfterFenceContent).map(item => ({
			code: item.code,
			line: item.line,
		})),
		[
			{ code: 'raw-math-identifier', line: 21 },
			{ code: 'raw-math-identifier', line: 25 },
			{ code: 'raw-math-slash-fraction', line: 25 },
		],
	);
}
