import assert from 'node:assert/strict';

import { validateSourcePunctuation } from '@/shared/lib/source-preflight/punctuation-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';

export function runTableCaptionRulesTests(): void {
	let count = 0;
	function check(source: string, expectedCodes: string[], line = 1): void {
		const issues: SourcePreflightIssue[] = [];
		validateSourcePunctuation('captions.md', source, issues);
		assert.deepEqual(
			issues.map(issue => [issue.code, issue.line, issue.file]),
			expectedCodes.map(code => [code, line, 'captions.md']),
			source,
		);
		count++;
	}

	for (const prefix of ['Таблица', 'Рисунок']) {
		const kind = prefix === 'Таблица' ? 'tab' : 'fig';
		for (const number of ['1', '2.1', 'А.1', 'Ё.1', `@${kind}:sample`]) {
			for (const anchor of ['', ` (@${kind}:sample)`]) {
				check(`${prefix} ${number} – Название${anchor}`, []);
				check(`${prefix} ${number}`, []);
				check(`${prefix} ${number}${anchor}`, []);
				check(`${prefix} ${number} – Название.${anchor}`, [
					'caption-final-period',
				]);
				for (const separator of ['', '- ', '— ', '–']) {
					const caption = `${prefix} ${number} ${separator}Название${anchor}`;
					check(
						kind === 'tab'
							? `${caption}\n\n| A |\n| - |\n| 1 |`
							: `![Пример](image.png)\n\n${caption}`,
						['caption-missing-en-dash-separator'],
						kind === 'tab' ? 1 : 3,
					);
				}
			}
		}
	}

	check('Таблица 1 Название.\n\nЗначение\n| - |\n1', [
		'caption-final-period',
		'caption-missing-en-dash-separator',
	]);
	for (const source of [
		'Продолжение таблицы 1',
		'Окончание таблицы А.1',
		'В таблице 1 приведены данные.',
		'Рисунок 1 показывает пример.',
		'Таблица 1 Название.',
		'Таблица 1 содержит результаты.',
		'Таблица А.1 представлена в приложении.',
		'1. Таблица содержит результаты.',
		'Таблица результатов содержит значения.',
		'Таблица 1а содержит значения.',
		'Пример: Таблица 1 – Название.',
		'`Таблица 1 – Пример.`',
		'```md\nТаблица 1 Без разделителя.\n```',
		'~~~md\nРисунок А.1 – Пример.\n~~~',
		'---\ntitle: Таблица 1 Пример.\n---',
	]) {
		check(source, []);
	}
	check('Таблица 1 содержит результаты. (@tab:sample)', [
		'caption-final-period',
		'caption-missing-en-dash-separator',
	]);
	check(
		'```md\nТаблица 1 Пример.\n```\n\nТаблица А.1 – Название. (@tab:sample)',
		['caption-final-period'],
		5,
	);
	console.log(
		`Table and figure caption rules tests passed (${count} cases).`,
	);
}
