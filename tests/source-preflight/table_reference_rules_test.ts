import assert from 'node:assert/strict';

import { validateObjectReferences } from '@/shared/lib/source-preflight/reference-checker';
import type { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

export function runTableReferenceRulesTests(): void {
	const cases: Array<[string, string, string[]]> = [
		[
			'unnamed labelled caption still needs a first reference',
			'Таблица 1 (@tab:data)',
			['table-before-reference'],
		],
		[
			'unnamed labelled caption accepts labelled reference',
			'В таблице @tab:data приведены значения.\n\nТаблица 1 (@tab:data)',
			[],
		],
		[
			'unnamed labelled caption accepts numeric reference',
			'В таблице 1 приведены значения.\n\nТаблица 1 (@tab:data)',
			[],
		],
		[
			'reference after caption is too late',
			'Таблица 1 (@tab:data)\n\nВ таблице @tab:data приведены значения.',
			['table-before-reference'],
		],
		[
			'unnamed labelled caption participates in numbering',
			'В таблице 2 приведены значения.\n\nТаблица 2 (@tab:data)',
			['object-number-sequence', 'single-object-number'],
		],
		[
			'unnamed labelled caption checks label kind',
			'Таблица 1 (@fig:data)',
			['object-label-kind', 'unknown-object-number'],
		],
		[
			'another caption is not a textual reference',
			'В таблице 1 приведены значения.\n\nТаблица 1 – Сравнение с таблицей 2 (@tab:first)\n\nТаблица 2 – Данные (@tab:second)',
			['table-before-reference'],
		],
		[
			'continuation label is not a textual reference',
			'Продолжение таблицы 1\n\nТаблица 1 – Данные (@tab:data)',
			['table-before-reference'],
		],
		[
			'prose mentioning a table is retained',
			'Таблица 1 содержит данные.\n\nТаблица 1 – Данные (@tab:data)',
			[],
		],
	];
	for (const [name, content, expected] of cases) {
		const issues: SourcePreflightIssue[] = [];
		validateObjectReferences([{ file: 'tables.md', content }], issues);
		assert.deepEqual(
			issues.map(item => item.code),
			expected,
			name,
		);
	}
	console.log(`Table reference rules: ${cases.length} cases passed.`);
}
