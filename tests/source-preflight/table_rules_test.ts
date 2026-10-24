import assert from 'node:assert/strict';
import { Lexer } from 'marked';

import { validateMarkdownTables } from '@/shared/lib/source-preflight/table-figure-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';
import { splitMarkdownTableRow } from '@/shared/lib/source-preflight/utils';

export function runTableRulesTests(): void {
	const cases: Array<{
		name: string;
		source: string;
		expected: Array<[string, number, string?]>;
	}> = [
		{
			name: 'extra body cell cannot be silently truncated',
			source: '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'missing body cell cannot be silently padded',
			source: '| A | B |\n| --- | --- |\n| 1 |',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'body row with no pipes is still padded by marked',
			source: '| A | B |\n| --- | --- |\nvalue',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'header and separator widths must agree',
			source: '| A | B |\n| --- | --- | --- |\n| 1 | 2 |',
			expected: [['table-header-column-count', 2]],
		},
		{
			name: 'separator with fewer cells',
			source: '| A | B |\n| --- |\n| 1 | 2 |',
			expected: [['table-header-column-count', 2]],
		},
		{
			name: 'separator cannot contain an empty cell',
			source: '| A | B |\n| --- | |\n| 1 | 2 |',
			expected: [['table-invalid-separator', 2]],
		},
		{
			name: 'separator colons must be at the edges',
			source: '| A | B |\n| --- | -:- |\n| 1 | 2 |',
			expected: [['table-invalid-separator', 2]],
		},
		{
			name: 'separator cannot contain text',
			source: '| A | B |\n| --- | invalid |\n| 1 | 2 |',
			expected: [['table-invalid-separator', 2]],
		},
		{
			name: 'empty header is retained in source diagnostics',
			source: '| A | |\n| --- | --- |\n| 1 | 2 |',
			expected: [['table-empty-header-cell', 1]],
		},
		{
			name: 'explicit empty body cell is distinct from a missing cell',
			source: '| A | B |\n| --- | --- |\n| 1 | |',
			expected: [['table-empty-source-cell', 3]],
		},
		{
			name: 'header final period remains checked',
			source: '| Показатель. | Значение |\n| --- | --- |\n| А | 1 |',
			expected: [['table-header-final-period', 1]],
		},
		{
			name: 'ordinal column remains a warning',
			source: '| № п/п | Значение |\n| --- | --- |\n| 1 | 2 |',
			expected: [['table-discouraged-ordinal-header', 1, 'warning']],
		},
		{
			name: 'optional outer pipes and independent data alignment',
			source: 'A | B\n:--- | ---:\n1 | 2\n3 | 4',
			expected: [],
		},
		{
			name: 'one column and short GFM delimiter',
			source: '| Значение |\n| - |\nданные\n–',
			expected: [],
		},
		{
			name: 'absence wording and repeated text require no guesswork',
			source: '| A | B |\n| --- | --- |\n| Нет данных | Не применимо |\n| Нет данных | – |\n| Повтор | Повтор |',
			expected: [],
		},
		{
			name: 'escaped literal pipes in text code and math are safe',
			source:
				'| A | B |\n| --- | --- |\n' +
				String.raw`| a\|b | \| |` +
				'\n' +
				'| `a\\|b` | $P(A\\|B)$ |',
			expected: [],
		},
		{
			name: 'raw code pipe needs GFM escaping',
			source: '| A | B |\n| --- | --- |\n| `a|b` | 1 |',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'raw math pipe needs GFM escaping',
			source: '| A | B |\n| --- | --- |\n| $P(A|B)$ | 1 |',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'heading and text after a blank line are outside the table',
			source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n# Раздел\n\nТекст.',
			expected: [],
		},
		{
			name: 'fenced examples and frontmatter are ignored with original lines',
			source:
				'---\nexample: |\n  | A | |\n  | --- | --- |\n---\n\n' +
				'````md\n| A | |\n| --- | --- |\n```\n| | |\n````\n' +
				'~~~md\n| A | |\n| --- | --- |\n~~~\n\n' +
				'| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
			expected: [['table-row-column-count', 20]],
		},
		{
			name: 'unclosed fence masks the remaining example',
			source: '```md\n| A | |\n| --- | --- |\n| 1 | |',
			expected: [],
		},
		{
			name: 'prose pipes and setext headings are not tables',
			source: 'A | B\nОбычный текст.\n\nЗаголовок\n---',
			expected: [],
		},
		{
			name: 'unpiped single column header cannot hide extra data cells',
			source: 'Значение\n| - |\n1 | 2',
			expected: [['table-row-column-count', 3]],
		},
		{
			name: 'HTML comments and indented code are not table attempts',
			source:
				'<!--\nA | B\n--- | ---\n1 | 2 | 3\n-->\n\n' +
				'    A |\n    - | -\n    1 | 2 | 3\n\n' +
				'| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
			expected: [['table-row-column-count', 13]],
		},
		{
			name: 'multiple tables retain separate source line numbers',
			source:
				'| A | B |\n| - | - |\n| 1 | 2 |\n\n' +
				'A | B\n--- | ---\n1 | 2 | 3',
			expected: [['table-row-column-count', 7]],
		},
	];

	for (const { name, source, expected } of cases) {
		const issues: SourcePreflightIssue[] = [];
		validateMarkdownTables('tables.md', source, issues);
		assert.deepEqual(
			issues.map(({ code, line, severity, file }) => [
				code,
				line,
				severity,
				file,
			]),
			expected.map(([code, line, severity = 'error']) => [
				code,
				line,
				severity,
				'tables.md',
			]),
			name,
		);
	}
	console.log(`Table source rules tests passed (${cases.length} cases).`);
	let parityCases = 0;
	for (let count = 0; count < 6; count++) {
		const escapes = '\\'.repeat(count);
		for (const header of [
			`A${escapes}|B | C`,
			`| A${escapes}|B | C |`,
			`A${escapes}|B | C |`,
			`| A${escapes}|B | C`,
			`A | B${escapes}|`,
			`| A | B${escapes}|`,
		]) {
			const columns = splitMarkdownTableRow(header).length;
			const separator = `| ${Array(columns).fill('---').join(' | ')} |`;
			const token = Lexer.lex(`${header}\n${separator}\n`).find(
				item => item.type === 'table',
			);
			assert.ok(
				token?.type === 'table',
				`GFM column count diverged for ${header}`,
			);
			assert.equal(token.header.length, columns);
			parityCases++;
		}
	}
	assert.equal(parityCases, 36);
	console.log(
		`GFM pipe escaping: ${parityCases} header/tokenizer parity cases passed.`,
	);
}
