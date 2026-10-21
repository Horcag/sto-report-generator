import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	applyWordcraftTableSplit,
	ensureWordcraftTablePageStart,
	inventoryWordcraftTables,
} from '@/app/wordcraft-tables';
import { getContinuationFailures } from '@/shared/lib/sto-validator/body-xml';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), 'sto-wordcraft-tables-'),
);
const file = path.join(directory, 'table.docx');
const caption =
	'<w:p><w:pPr><w:pStyle w:val="TableCaption"/><w:jc w:val="center"/></w:pPr><w:r><w:t>Таблица 2.1 – Проверка</w:t></w:r></w:p>';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, properties = '') =>
	`<w:tc><w:tcPr>${properties}<w:tcBorders><w:bottom w:val="single"/></w:tcBorders></w:tcPr>${paragraph(text)}</w:tc>`;
const row = (text: string, properties = '', cellProperties = '') =>
	`<w:tr><w:trPr>${properties}</w:trPr>${cell(text, cellProperties)}</w:tr>`;
const header = row('Заголовок', '<w:tblHeader/>', '<w:gridSpan w:val="2"/>');
const richRow =
	'<w:tr><w:tc><w:tcPr/><w:p><w:hyperlink r:id="rId1"><w:r><w:rPr><w:b/></w:rPr><w:t>Ссылка</w:t></w:r></w:hyperlink><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath><w:bookmarkStart w:id="7" w:name="data"/><w:bookmarkEnd w:id="7"/></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id="9" name="figure"/></wp:inline></w:drawing></w:r></w:p></w:tc></w:tr>';
const table = (rows: string) =>
	`<w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>${rows}</w:tbl>`;
const normalRows = header + row('Первая') + richRow + row('Последняя');
function write(body: string): void {
	const archive = new AdmZip();
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="${WORD}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr/></w:body></w:document>`,
		),
	);
	archive.addFile('word/media/image.bin', Buffer.from([0, 1, 255, 24]));
	archive.addFile(
		'word/_rels/document.xml.rels',
		Buffer.from('unchanged relationship bytes'),
	);
	archive.writeZip(file);
}
function documentXml(): Document {
	return new JSDOM(new AdmZip(file).readAsText('word/document.xml'), {
		contentType: 'text/xml',
	}).window.document;
}
function rowsOf(table: Element): string[] {
	return Array.from(table.children)
		.filter(node => node.localName === 'tr')
		.map(node => node.outerHTML);
}
function split(splitBeforeRow = 2) {
	const candidate = inventoryWordcraftTables(file).tables[0];
	assert.ok(candidate);
	return applyWordcraftTableSplit(file, {
		tableBlock: candidate.tableBlock,
		splitBeforeRow,
		expectedRowCount: candidate.rowCount,
		expectedTableSha256: candidate.tableSha256,
	});
}
let checks = 0;
function check(name: string, run: () => void): void {
	run();
	checks++;
	console.log(`PASS ${name}`);
}
try {
	check(
		'inventory probes every cell paragraph, preserving block positions',
		() => {
			write(paragraph('Введение') + caption + table(normalRows));
			const result = inventoryWordcraftTables(file);
			assert.deepEqual(result.warnings, []);
			const candidate = result.tables[0];
			assert.equal(candidate.tableBlock, 2);
			assert.equal(candidate.captionBlock, 1);
			assert.equal(candidate.number, '2.1');
			assert.equal(candidate.headerRows, 1);
			assert.equal(candidate.rowCount, 4);
			assert.deepEqual(candidate.safeSplitRows, [2, 3]);
			assert.equal(candidate.probes.length, 10);
			assert.deepEqual(candidate.probes[7], {
				path: [2, 2, 0, 1],
				row: 2,
				edge: 'end',
			});
		},
	);
	check(
		'split preserves rich tail XML, repeated headers, grid, ZIP parts and STO border rules',
		() => {
			const before = documentXml().getElementsByTagNameNS(WORD, 'tbl')[0];
			const originalRows = rowsOf(before);
			const grid = before.getElementsByTagNameNS(WORD, 'tblGrid')[0]
				.outerHTML;
			assert.deepEqual(split(), {
				originalRows: 4,
				headerRows: 1,
				continuationRows: 3,
			});
			const archive = new AdmZip(file);
			assert.deepEqual(
				archive.getEntry('word/media/image.bin')!.getData(),
				Buffer.from([0, 1, 255, 24]),
			);
			assert.equal(
				archive.readAsText('word/_rels/document.xml.rels'),
				'unchanged relationship bytes',
			);
			const document = documentXml();
			const tables = document.getElementsByTagNameNS(WORD, 'tbl');
			assert.equal(tables.length, 2);
			assert.equal(rowsOf(tables[0]).length, 2);
			assert.deepEqual(rowsOf(tables[1]), [
				originalRows[0],
				...originalRows.slice(2),
			]);
			assert.equal(
				tables[1].getElementsByTagNameNS(WORD, 'tblGrid')[0].outerHTML,
				grid,
			);
			const continuation = tables[1].previousElementSibling!;
			assert.equal(continuation.textContent, 'Продолжение таблицы 2.1');
			for (const name of ['pageBreakBefore', 'keepNext'])
				assert.equal(
					continuation
						.getElementsByTagNameNS(WORD, name)[0]
						.getAttributeNS(WORD, 'val'),
					'1',
				);
			assert.equal(
				continuation
					.getElementsByTagNameNS(WORD, 'jc')[0]
					.getAttributeNS(WORD, 'val'),
				'left',
			);
			assert.deepEqual(
				getContinuationFailures(
					archive.readAsText('word/document.xml'),
					'<w:styles><w:style w:styleId="TableCaption"></w:style></w:styles>',
				),
				{ label: 0, border: 0 },
			);
			assert.equal(
				inventoryWordcraftTables(file).tables[1].number,
				'2.1',
			);
		},
	);
	check('stale count and hash plans reject without writing', () => {
		write(caption + table(normalRows));
		const candidate = inventoryWordcraftTables(file).tables[0];
		const bytes = fs.readFileSync(file);
		for (const change of [
			{ expectedRowCount: 99 },
			{ expectedTableSha256: 'wrong' },
		]) {
			assert.throws(
				() =>
					applyWordcraftTableSplit(file, {
						...candidate,
						splitBeforeRow: 2,
						expectedRowCount: 4,
						expectedTableSha256: candidate.tableSha256,
						...change,
					}),
				/stale plan/,
			);
			assert.deepEqual(fs.readFileSync(file), bytes);
		}
		for (const index of [0, 1, 4, -1, 2.5])
			assert.throws(() => split(index), /unsafe split/);
	});
	check(
		'vertical merge crossing is unsafe; merges within a segment and grid spans survive',
		() => {
			write(
				caption +
					table(
						header +
							row('a', '', '<w:vMerge w:val="restart"/>') +
							row('b', '', '<w:vMerge/>') +
							row('c'),
					),
			);
			assert.deepEqual(
				inventoryWordcraftTables(file).tables[0].safeSplitRows,
				[3],
			);
			assert.throws(() => split(2), /crossing vertical merge/);
			const before = rowsOf(
				documentXml().getElementsByTagNameNS(WORD, 'tbl')[0],
			);
			split(3);
			const after = documentXml().getElementsByTagNameNS(WORD, 'tbl');
			assert.equal(rowsOf(after[0])[1], before[1]);
			assert.equal(
				after[0].getElementsByTagNameNS(WORD, 'vMerge').length,
				2,
			);
			assert.equal(
				after[1].getElementsByTagNameNS(WORD, 'gridSpan').length,
				1,
			);
		},
	);
	check('multiple contiguous header rows repeat as an intact prefix', () => {
		write(caption + table(header + header + row('a') + row('b')));
		assert.deepEqual(
			inventoryWordcraftTables(file).tables[0].safeSplitRows,
			[3],
		);
		assert.deepEqual(split(3), {
			originalRows: 4,
			headerRows: 2,
			continuationRows: 3,
		});
	});
	check('uncaptioned tables and separated captions are excluded', () => {
		write(table(normalRows) + caption + paragraph('') + table(normalRows));
		assert.deepEqual(inventoryWordcraftTables(file), {
			tables: [],
			warnings: [],
		});
	});
	check(
		'nested tables and ambiguous containers refuse inventory and mutation',
		() => {
			for (const body of [
				caption +
					table(
						header +
							row('a') +
							`<w:tr><w:tc>${table(header)}</w:tc></w:tr>`,
					),
				caption + table(header + row('a') + '<w:sdt/>'),
				'<w:sdt/>' + caption + table(normalRows),
				caption +
					table(
						header +
							row('a') +
							'<w:tr><w:tc><w:sdt/></w:tc></w:tr>',
					),
			]) {
				write(body);
				const result = inventoryWordcraftTables(file);
				assert.equal(result.tables.length, 0);
				assert.equal(result.warnings.length, 1);
				assert.throws(() =>
					applyWordcraftTableSplit(file, {
						tableBlock: 1,
						splitBeforeRow: 2,
						expectedRowCount: 3,
						expectedTableSha256: '',
					}),
				);
			}
		},
	);
	check('captioned borderless math wrappers are excluded', () => {
		const math =
			'<w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>';
		write(caption + math);
		assert.deepEqual(inventoryWordcraftTables(file), {
			tables: [],
			warnings: [],
		});
	});
	check('noncontiguous header markers are refused', () => {
		write(caption + table(header + row('a') + header + row('b')));
		assert.match(
			inventoryWordcraftTables(file).warnings[0],
			/contiguous repeated header/,
		);
	});
	check(
		'unsafe header identities and missing repeated headers refuse safely',
		() => {
			for (const marker of [
				'<w:bookmarkStart w:id="1"/>',
				'<wp:docPr id="1"/>',
				'<w:commentReference w:id="1"/>',
				'<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr></w:sdt>',
			]) {
				write(
					caption +
						table(
							header.replace('</w:p>', `${marker}</w:p>`) +
								row('a') +
								row('b'),
						),
				);
				assert.match(
					inventoryWordcraftTables(file).warnings[0],
					/unsafe duplicate identifier/,
				);
				assert.throws(
					() =>
						applyWordcraftTableSplit(file, {
							tableBlock: 1,
							splitBeforeRow: 2,
							expectedRowCount: 3,
							expectedTableSha256: '',
						}),
					/unsafe duplicate identifier/,
				);
			}
			write(caption + table(row('a') + row('b') + row('c')));
			assert.match(
				inventoryWordcraftTables(file).warnings[0],
				/repeated header/,
			);
		},
	);
	check(
		'page-start repair preserves caption and table, validates plans and is idempotent',
		() => {
			write(caption + table(normalRows));
			const candidate = inventoryWordcraftTables(file).tables[0];
			const plan = {
				tableBlock: candidate.tableBlock,
				expectedRowCount: candidate.rowCount,
				expectedTableSha256: candidate.tableSha256,
			};
			const original = documentXml().getElementsByTagNameNS(
				WORD,
				'tbl',
			)[0].outerHTML;
			assert.throws(
				() =>
					ensureWordcraftTablePageStart(file, {
						...plan,
						expectedRowCount: 99,
					}),
				/stale plan/,
			);
			assert.equal(ensureWordcraftTablePageStart(file, plan), true);
			const repaired = documentXml();
			assert.equal(
				repaired.getElementsByTagNameNS(WORD, 'tbl')[0].outerHTML,
				original,
			);
			assert.equal(
				repaired
					.getElementsByTagNameNS(WORD, 'pStyle')[0]
					.getAttributeNS(WORD, 'val'),
				'TableCaption',
			);
			assert.equal(
				repaired
					.getElementsByTagNameNS(WORD, 'jc')[0]
					.getAttributeNS(WORD, 'val'),
				'left',
			);
			assert.equal(
				repaired
					.getElementsByTagNameNS(WORD, 'pageBreakBefore')[0]
					.getAttributeNS(WORD, 'val'),
				'1',
			);
			assert.equal(
				repaired
					.getElementsByTagNameNS(WORD, 'keepNext')[0]
					.getAttributeNS(WORD, 'val'),
				'1',
			);
			const bytes = fs.readFileSync(file);
			assert.equal(ensureWordcraftTablePageStart(file, plan), false);
			assert.deepEqual(fs.readFileSync(file), bytes);
		},
	);
	check(
		'continuation caption copies formatting without section boundaries or tracked property identities',
		() => {
			const structural = caption.replace(
				'</w:pPr>',
				'<w:spacing w:after="120"/><w:sectPr><w:pgSz w:w="16838" w:h="11906"/></w:sectPr><w:pPrChange w:id="42"><w:pPr><w:jc w:val="right"/></w:pPr></w:pPrChange></w:pPr>',
			);
			write(structural + table(normalRows));
			const before = documentXml();
			const originalCaption = before.getElementsByTagNameNS(WORD, 'p')[0]
				.outerHTML;
			const originalSections = Array.from(
				before.getElementsByTagNameNS(WORD, 'sectPr'),
			).map(section => section.outerHTML);
			split();
			const after = documentXml();
			const captions = Array.from(
				after.getElementsByTagNameNS(WORD, 'body')[0].children,
			).filter(node => node.localName === 'p');
			assert.equal(
				captions[0].outerHTML,
				originalCaption,
				'original caption properties remain unchanged',
			);
			assert.deepEqual(
				Array.from(after.getElementsByTagNameNS(WORD, 'sectPr')).map(
					section => section.outerHTML,
				),
				originalSections,
			);
			assert.equal(
				captions[1].getElementsByTagNameNS(WORD, 'sectPr').length,
				0,
			);
			assert.equal(
				captions[1].getElementsByTagNameNS(WORD, 'pPrChange').length,
				0,
			);
			assert.equal(
				after.getElementsByTagNameNS(WORD, 'pPrChange').length,
				1,
			);
			assert.equal(
				captions[1]
					.getElementsByTagNameNS(WORD, 'spacing')[0]
					.getAttributeNS(WORD, 'after'),
				'120',
			);
			assert.equal(
				captions[1]
					.getElementsByTagNameNS(WORD, 'pStyle')[0]
					.getAttributeNS(WORD, 'val'),
				'TableCaption',
			);
		},
	);
	check(
		'standard TOC content-control paragraphs map to CLI blocks without changing the wrapper',
		() => {
			const toc =
				'<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>' +
				paragraph('Оглавление 1') +
				paragraph('Оглавление 2') +
				paragraph('Оглавление 3') +
				'</w:sdtContent></w:sdt>';
			write(paragraph('Вступление') + toc + caption + table(normalRows));
			const before = new AdmZip(file)
				.readAsText('word/document.xml')
				.match(/<w:sdt>.*?<\/w:sdt>/s)![0];
			const result = inventoryWordcraftTables(file);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.tables[0].tableBlock, 5);
			assert.equal(result.tables[0].captionBlock, 4);
			assert.deepEqual(result.tables[0].probes[0].path, [5, 0, 0, 0]);
			split();
			const after = new AdmZip(file)
				.readAsText('word/document.xml')
				.match(/<w:sdt>.*?<\/w:sdt>/s)![0];
			assert.equal(after, before, 'TOC wrapper bytes remain intact');
			assert.deepEqual(
				inventoryWordcraftTables(file).tables.map(
					candidate => candidate.tableBlock,
				),
				[5, 7],
			);
			write(
				toc.replace(paragraph('Оглавление 3'), table(header)) +
					caption +
					table(normalRows),
			);
			assert.equal(inventoryWordcraftTables(file).tables.length, 0);
			assert.match(
				inventoryWordcraftTables(file).warnings[0],
				/ambiguous body/,
			);
		},
	);
	console.log(`Wordcraft table XML tests: ${checks} passed.`);
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
	assert.equal(fs.existsSync(directory), false);
}
