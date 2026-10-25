import assert from 'node:assert/strict';
import path from 'node:path';

import { parseMarkdownToDocx } from '@/features/markdown-parser';

interface TableParserHarness {
	tempRoot: string;
	packAndReadXml: (
		children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
		outputPath: string,
	) => Promise<{ documentXml: string; numberingXml: string }>;
	paragraphContaining: (xml: string, text: string) => string;
}

export async function runTableParserTests({
	tempRoot,
	packAndReadXml,
	paragraphContaining,
}: TableParserHarness): Promise<void> {
	const tableElements = await parseMarkdownToDocx(
		String.raw`<!-- widths: 30, 70 -->
| Заголовок 1 | Заголовок 2 <br> вторая строка |
| :---: | ---: |
| Ячейка 1 | Текст <br> с переносом |
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: tableDocXml } = await packAndReadXml(
		tableElements,
		path.join(tempRoot, 'table-test.docx'),
	);
	assert.match(tableDocXml, /<w:tblHeader\/>/);
	assert.match(tableDocXml, /<w:cantSplit\/>/);
	assert.doesNotMatch(
		tableDocXml,
		/<w:b\/>/,
		'Table headers must not be made bold implicitly',
	);
	assert.match(
		tableDocXml,
		/<w:jc w:val="center"\/>/,
		'Markdown center alignment must be preserved in the header',
	);
	assert.match(tableDocXml, /<w:br\/>/);
	assert.match(tableDocXml, /w:w="2807"/);

	const tableCaptionElements = await parseMarkdownToDocx(
		String.raw`<!-- widths: 40, 60 -->
Таблица 1 – Тестовая таблица
| Кол 1 | Кол 2 |
| :--- | :--- |
| Данные 1 | Данные 2 |

## Следующий раздел
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: tableCaptionDocXml } = await packAndReadXml(
		tableCaptionElements,
		path.join(tempRoot, 'table-caption-test.docx'),
	);
	assert.match(
		tableCaptionDocXml,
		/w:w="3742"/,
		'Explicit widths before a table caption must be preserved',
	);
	const continuationElements = await parseMarkdownToDocx(
		'Таблица 1 – Данные\n\n| Поле | Значение |\n| --- | --- |\n| A | B |\n\nПродолжение таблицы 1\n\n| Поле | Значение |\n| --- | --- |\n| C | D |',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: continuationXml } = await packAndReadXml(
		continuationElements,
		path.join(tempRoot, 'table-continuation-test.docx'),
	);
	assert.match(
		paragraphContaining(continuationXml, 'Продолжение таблицы 1'),
		/<w:pStyle w:val="TableCaption"\/>/,
	);
	assert.match(
		paragraphContaining(continuationXml, 'Продолжение таблицы 1'),
		/<w:pageBreakBefore\/>/,
		'Explicit source continuations start on a new page, so removing the previous bottom border has a page-boundary trigger.',
	);
	const firstContinuedTable = continuationXml.match(
		/<w:tbl\b[\s\S]*?<\/w:tbl>/,
	)?.[0];
	assert.ok(firstContinuedTable);
	assert.match(firstContinuedTable, /<w:bottom w:val="none"/);
	const firstContinuedTableEnd = continuationXml.indexOf('</w:tbl>');
	const continuationCaptionIndex = continuationXml.indexOf(
		paragraphContaining(continuationXml, 'Продолжение таблицы 1'),
	);
	assert.ok(
		continuationCaptionIndex > firstContinuedTableEnd,
		'Continuation caption must follow the first table segment',
	);
	assert.doesNotMatch(
		continuationXml.slice(firstContinuedTableEnd, continuationCaptionIndex),
		/<w:p><w:pPr><w:pStyle w:val="Normal"/,
		'Continuation captions must remain adjacent to the preceding table segment',
	);
	const noteMarkdown =
		'Таблица 1 – Данные\n\n| Поле | Значение |\n| --- | --- |\n| A | B |\n\nПримечание – Данные приведены для примера.\n\nСледующий текст.';
	const { documentXml: noteXml } = await packAndReadXml(
		await parseMarkdownToDocx(noteMarkdown, {}, { sourceDir: tempRoot }),
		path.join(tempRoot, 'table-note.docx'),
	);
	const noteTable = noteXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/)?.[0];
	assert.ok(noteTable);
	assert.equal(
		(noteXml.match(/Данные приведены для примера/g) ?? []).length,
		1,
	);
	assert.match(noteTable, /<w:gridSpan w:val="2"\/>/);
	assert.match(noteTable, /<w:pStyle w:val="TableNote"\/>/);
	assert.match(noteTable, /Примечание – Данные приведены для примера/);
	assert.ok(noteXml.indexOf('Следующий текст') > noteXml.indexOf('</w:tbl>'));
	const plural = noteMarkdown.replace(
		'Примечание – Данные приведены для примера.',
		'Примечания\n\n1 Первое пояснение.\n\n2 Второе пояснение.',
	);
	await assert.rejects(
		parseMarkdownToDocx(
			noteMarkdown.replace(
				'Следующий текст.',
				'Примечание – Второе пояснение.',
			),
			{},
			{ sourceDir: tempRoot },
		),
		/plural label/,
	);
	const { documentXml: pluralXml } = await packAndReadXml(
		await parseMarkdownToDocx(plural, {}, { sourceDir: tempRoot }),
		path.join(tempRoot, 'table-multiple-notes.docx'),
	);
	const pluralTable = pluralXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/)?.[0] ?? '';
	assert.match(pluralTable, /Примечания/);
	assert.match(pluralTable, /1 Первое пояснение/);
	assert.match(pluralTable, /2 Второе пояснение/);
	assert.equal((pluralTable.match(/<w:gridSpan/g) ?? []).length, 3);
	await assert.rejects(
		parseMarkdownToDocx(
			plural.replace('2 Второе', '3 Второе'),
			{},
			{ sourceDir: tempRoot },
		),
		/sequential paragraphs/,
	);

	await assert.rejects(
		parseMarkdownToDocx(
			noteMarkdown.replace(
				'Следующий текст.',
				'Продолжение таблицы 1\n\n| Поле | Значение |\n| --- | --- |\n| C | D |',
			),
			{},
			{ sourceDir: tempRoot },
		),
		/Table notes must follow the final table segment/,
	);
}
