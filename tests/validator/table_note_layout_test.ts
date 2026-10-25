import assert from 'node:assert/strict';

import { getNoteFailures } from '@/shared/lib/sto-validator/body-xml';

import {
	cell,
	documentXml,
	paragraph,
	row,
	table,
} from './table_layout_fixtures';

export function runTableNoteLayoutTests(): void {
	const note = row(
		cell(paragraph('Примечание – Пояснение.')) + cell('<w:p/>'),
		'',
	);
	const data = row(cell(paragraph('12')) + cell(paragraph('20')), '');
	const continuation = paragraph('Продолжение таблицы 1');
	const noteRow = (text: string) =>
		row(cell(paragraph(text), '<w:gridSpan w:val="2"/>'), '');
	const plural =
		noteRow('Примечания') +
		noteRow('1 Первое пояснение.') +
		noteRow('2 Второе пояснение.');
	const cases: Array<[string, string, number, number]> = [
		[
			'multiple singular notes rejected',
			table(
				row() +
					noteRow('Примечание – Первое.') +
					noteRow('Примечание – Второе.'),
			),
			2,
			0,
		],
		['two plural notes are final rows', table(row() + data + plural), 0, 0],
		[
			'plural note group before data rejected',
			table(row() + plural + data),
			0,
			1,
		],
		[
			'plural notes before continuation rejected',
			table(row() + plural) + continuation + table(),
			0,
			1,
		],
		[
			'plural numbering gap rejected',
			table(
				row() +
					noteRow('Примечания') +
					noteRow('1 Первое пояснение.') +
					noteRow('3 Второе пояснение.'),
			),
			1,
			0,
		],
		[
			'dotted plural numbering rejected',
			table(
				row() +
					noteRow('Примечания') +
					noteRow('1. Первое пояснение.') +
					noteRow('2 Второе пояснение.'),
			),
			1,
			0,
		],
		[
			'single item cannot form plural group',
			table(row() + noteRow('Примечания') + noteRow('1 Пояснение.')),
			1,
			0,
		],
		[
			'bare plural label can remain ordinary data',
			table(row() + noteRow('Примечания') + data),
			0,
			0,
		],
		['final table note permitted', table(row() + data + note), 0, 0],
		['note before data rejected', table(row() + note + data), 0, 1],
		[
			'note before continuation rejected',
			table(row() + data + note) + continuation + table(),
			0,
			1,
		],
		[
			'note before ordinary text permitted',
			table(row() + data + note) + paragraph('Following text.'),
			0,
			0,
		],
		[
			'unambiguous hyphen note form rejected',
			table(
				row() +
					row(
						cell(paragraph('Примечание - Пояснение.')) + cell(),
						'',
					),
			),
			1,
			0,
		],
		[
			'ordinary word note is not note metadata',
			table(
				row() + row(cell(paragraph('Примечание')) + cell(), '') + data,
			),
			0,
			0,
		],
		[
			'nested note ends its own table',
			table(
				row(
					cell(
						paragraph('Nested data') + table(row() + data + note),
					) + cell(),
				) + data,
			),
			0,
			0,
		],
		[
			'nested note before inner data rejected',
			table(
				row(
					cell(
						paragraph('Nested data') + table(row() + note + data),
					) + cell(),
				),
			),
			0,
			1,
		],
		[
			'inner final note does not prevent outer continuation',
			table(
				row(
					cell(
						paragraph('Nested data') + table(row() + data + note),
					) + cell(),
				),
			) +
				continuation +
				table(),
			0,
			0,
		],
		[
			'external note before continuation retained',
			table() +
				paragraph('Примечание – Пояснение.') +
				continuation +
				table(),
			0,
			1,
		],
	];
	for (const [name, body, form, tableEnd] of cases) {
		assert.deepEqual(
			getNoteFailures(documentXml(body)),
			{ placement: 0, form, tableEnd },
			name,
		);
	}
	console.log(`Table note placement: ${cases.length} cases passed.`);
}
