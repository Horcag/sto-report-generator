import assert from 'node:assert/strict';

import { validateMarkdownTables } from '@/shared/lib/source-preflight/table-figure-checker';
import type { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

export function runTableCellContentTests(): void {
	const cases: Array<[string, string, Array<[string, number, string]>]> = [
		[
			'multiple singular notes rejected',
			'| Value |\n| - |\n| Примечание – Первое. |\n| Примечание – Второе. |',
			[
				['table-note-form', 3, 'error'],
				['table-note-form', 4, 'error'],
			],
		],
		[
			'two plural notes valid',
			'| Value |\n| - |\n| 12 |\n| Примечания |\n| 1 Первое пояснение. |\n| 2 Второе пояснение. |',
			[],
		],
		[
			'plural group before data rejected',
			'| Value |\n| - |\n| Примечания |\n| 1 Первое пояснение. |\n| 2 Второе пояснение. |\n| 12 |',
			[['table-note-before-data', 3, 'error']],
		],
		[
			'plural group numbering gap rejected',
			'| Value |\n| - |\n| Примечания |\n| 1 Первое пояснение. |\n| 3 Второе пояснение. |',
			[['table-note-form', 5, 'error']],
		],
		[
			'plural numbering dots rejected',
			'| Value |\n| - |\n| Примечания |\n| 1. Первое пояснение. |\n| 2 Второе пояснение. |',
			[['table-note-form', 4, 'error']],
		],
		[
			'single numbered item cannot form plural group',
			'| Value |\n| - |\n| Примечания |\n| 1 Пояснение. |',
			[['table-note-form', 3, 'error']],
		],
		[
			'bare plural label retained as ordinary data',
			'| Value |\n| - |\n| Примечания |\n| 12 |',
			[],
		],
		[
			'date-labelled values are not assumed decimal',
			'| Дата |\n| - |\n| 12.10 |',
			[],
		],
		[
			'ordinary note text starts uppercase',
			'| Value |\n| - |\n| Примечание – пояснение. |',
			[['table-note-capitalization', 3, 'warning']],
		],
		[
			'pure decimal point is a warning',
			'| Value |\n| - |\n| 1.25 |',
			[['table-decimal-dot', 3, 'warning']],
		],
		[
			'signed decimal exponent is a warning',
			'| Value |\n| - |\n| -0.25e-3 |',
			[['table-decimal-dot', 3, 'warning']],
		],
		[
			'versions remain advisory',
			'| Version |\n| - |\n| 1.2 |',
			[['table-decimal-dot', 3, 'warning']],
		],
		[
			'comma decimals and identifiers retained',
			'| Value |\n| - |\n| 1,25 |\n| v1.2 |\n| 2026-10-25 |\n| 25.10.2026 |\n| ID-1.25 |\n| https://example.org/1.25 |\n| `1.25` |\n| $1.25$ |',
			[],
		],
		[
			'integer repetition quote warns',
			'| Value |\n| - |\n| 12 |\n| " |',
			[['table-quoted-numeric-repeat', 4, 'warning']],
		],
		[
			'quote chain retains numeric origin',
			'| Value |\n| - |\n| 1,25 |\n| » |\n| 〃 |',
			[
				['table-quoted-numeric-repeat', 4, 'warning'],
				['table-quoted-numeric-repeat', 5, 'warning'],
			],
		],
		[
			'explicit symbol repetition warns',
			'| Value |\n| - |\n| ± |\n| " |',
			[['table-quoted-numeric-repeat', 4, 'warning']],
		],
		[
			'single word repetition permitted',
			'| Value |\n| - |\n| Слово |\n| " |',
			[],
		],
		[
			'unresolved symbolic or quoted text retained',
			'| Value |\n| - |\n| $x$ |\n| " |\n| «Цитата» |',
			[],
		],
		[
			'column origins are independent',
			'| Name | Value |\n| - | - |\n| Слово | 12 |\n| " | 13 |',
			[],
		],
		[
			'plain lowercase Cyrillic heading is advisory',
			'| число элементов |\n| - |\n| 12 |',
			[['table-heading-capitalization', 1, 'warning']],
		],
		[
			'notation abbreviations markup and capitals retained',
			'| pH | ЭВМ | $x$ | `data` | Число |\n| - | - | - | - | - |\n| 1 | 2 | 3 | 4 | 5 |',
			[],
		],
		[
			'final explicit note is valid',
			'| Value |\n| - |\n| 12 |\n| Примечание – Пояснение. |',
			[],
		],
		[
			'explicit note before data rejected',
			'| Value |\n| - |\n| Примечание – Пояснение. |\n| 12 |',
			[['table-note-before-data', 3, 'error']],
		],
		[
			'explicit note hyphen rejected',
			'| Value |\n| - |\n| 12 |\n| Примечание - Пояснение. |',
			[['table-note-form', 4, 'error']],
		],
		[
			'note word as ordinary data is not metadata',
			'| Термин |\n| - |\n| Примечание |\n| 12 |',
			[],
		],
		[
			'fenced examples ignored',
			'```md\n| значение |\n| - |\n| 1.25 |\n| " |\n```',
			[],
		],
		[
			'unpiped GFM table gets the same checks',
			'Value\n| - |\n1.25',
			[['table-decimal-dot', 3, 'warning']],
		],
	];
	for (const [name, source, expected] of cases) {
		const issues: SourcePreflightIssue[] = [];
		validateMarkdownTables('cells.md', source, issues);
		assert.deepEqual(
			issues.map(item => [item.code, item.line, item.severity]),
			expected,
			name,
		);
	}
	console.log(`Table cell content: ${cases.length} cases passed.`);
}
