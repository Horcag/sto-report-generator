import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';
import { Tokens } from 'marked';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { computeTableColumnWidths } from '@/features/markdown-parser/lib/parser/handlers/block-handlers';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx-archive';

const tempRoot = path.join(process.cwd(), '.agent-work', 'table-layout-tests');

async function packAndReadXml(
	children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
	outputPath: string,
): Promise<string> {
	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [{ children }],
	});
	fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
	return readDocxEntry(outputPath, 'word/document.xml');
}

async function run(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });

	// 1. Direct unit tests for computeTableColumnWidths edge cases
	const emptyWidths = computeTableColumnWidths({
		header: [],
		rows: [],
	} as unknown as Tokens.Table);
	assert.deepEqual(emptyWidths, []);

	// CommonMark delimiter length must not masquerade as a physical width hint.
	const delimToken = {
		header: [{ text: 'A' }, { text: 'B' }],
		rows: [[{ text: '1' }, { text: '2' }]],
		align: [null, null],
		raw: '| A | B |\n|:---|:------------------|\n| 1 | 2 |\n',
	} as unknown as Tokens.Table;
	const delimWidths = computeTableColumnWidths(delimToken);
	assert.equal(delimWidths.length, 2);
	assert.ok(Math.abs(delimWidths[0] - delimWidths[1]) <= 1);

	const explicitWidths = computeTableColumnWidths(delimToken, [1, 3]);
	assert.ok(explicitWidths[1] > explicitWidths[0] * 2);

	// 2. Integration test: Table with center/right alignment, bold cells, br tags, header markup
	const markdown = `
| **Колонка 1** | *Колонка 2* | \`Колонка 3\` |
| :--- | :---: | ---: |
| Текст 1 | **Жирный текст** | Текст<br/>вторая строка |
| Обычный | Текст<br>с переносом | \`код\` |
`;
	const elements = await parseMarkdownToDocx(
		markdown,
		{},
		{ sourceDir: tempRoot },
	);
	const docXml = await packAndReadXml(
		elements,
		path.join(tempRoot, 'table_alignments.docx'),
	);

	assert.match(docXml, /w:jc w:val="center"/);
	assert.match(docXml, /w:jc w:val="right"/);
	assert.match(docXml, /<w:b\/>/);
	assert.match(docXml, /<w:br\/>/);
	assert.match(
		docXml,
		/<w:tblCellMar><w:top w:type="dxa" w:w="0"\/><w:left w:type="dxa" w:w="108"\/><w:bottom w:type="dxa" w:w="0"\/><w:right w:type="dxa" w:w="108"\/><\/w:tblCellMar>/,
	);
	assert.match(
		docXml,
		/<w:tcMar><w:left w:type="dxa" w:w="108"\/><w:right w:type="dxa" w:w="108"\/><\/w:tcMar>/,
	);

	const plainHeaderElements = await parseMarkdownToDocx(
		'| Заголовок | Значение |\n| :--- | ---: |\n| Текст | 1 |',
		{},
		{ sourceDir: tempRoot },
	);
	const plainHeaderXml = await packAndReadXml(
		plainHeaderElements,
		path.join(tempRoot, 'table_plain_header.docx'),
	);
	assert.doesNotMatch(
		plainHeaderXml,
		/<w:b\/>/,
		'STO and the canonical DOTM do not make table headers bold by default',
	);

	// 3. Wide table exceeding TOTAL_TABLE_WIDTH_DXA to exercise the proportional scaling branch
	const wideHeaders = Array.from(
		{ length: 12 },
		(_, i) => `ДлинныйКолоночныйЗаголовок${i + 1}`,
	);
	const wideRow = Array.from(
		{ length: 12 },
		() => 'ДлинноеЗначениеДляШирины',
	);
	const wideMd = `
| ${wideHeaders.join(' | ')} |
| ${wideHeaders.map(() => ':---').join(' | ')} |
| ${wideRow.join(' | ')} |
`;
	const wideElements = await parseMarkdownToDocx(
		wideMd,
		{},
		{ sourceDir: tempRoot },
	);
	const wideDocXml = await packAndReadXml(
		wideElements,
		path.join(tempRoot, 'table_wide.docx'),
	);
	assert.match(wideDocXml, /w:tblLayout w:type="fixed"/);

	console.log('Table layout and coverage tests passed.');
}

run().catch(error => {
	console.error(error);
	process.exit(1);
});
