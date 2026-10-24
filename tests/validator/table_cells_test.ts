import assert from 'node:assert/strict';

import {
	countEmptyTableCells,
	countTablesWithDiagonalBorders,
} from '@/shared/lib/sto-validator/layout-xml';

const documentXml = (cell: string, properties = '') =>
	`<w:document><w:body><w:tbl><w:tblPr>${properties}</w:tblPr><w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl></w:body></w:document>`;
const paragraph = (value: string) =>
	`<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;

let cases = 0;
for (const [cell, expected] of [
	['<w:p/>', 1],
	[paragraph(' '), 1],
	['<w:p><w:r><w:br/></w:r></w:p>', 1],
	[paragraph('–'), 0],
	[paragraph('Нет данных'), 0],
	[paragraph('0'), 0],
	['<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>', 0],
	['<w:p><w:r><w:drawing/></w:r></w:p>', 0],
	['<w:tcPr><w:vMerge/></w:tcPr><w:p/>', 0],
	['<w:tcPr><w:vMerge w:val="continue"/></w:tcPr><w:p/>', 0],
	['<w:tcPr><w:hMerge/></w:tcPr><w:p/>', 0],
	['<w:tcPr><w:hMerge w:val="continue"/></w:tcPr><w:p/>', 0],
	['<w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p/>', 1],
	['<w:tcPr><w:hMerge w:val="restart"/></w:tcPr><w:p/>', 1],
	['<w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/>', 1],
] as const) {
	assert.equal(countEmptyTableCells(documentXml(cell)), expected, cell);
	cases++;
}
for (const edge of ['tl2br', 'tr2bl']) {
	for (const [value, expected] of [
		['none', 0],
		['nil', 0],
		['single', 1],
	] as const) {
		const border = `<w:${edge} w:val="${value}"/>`;
		assert.equal(
			countTablesWithDiagonalBorders(
				documentXml(
					paragraph('A'),
					`<w:tblBorders>${border}</w:tblBorders>`,
				),
			),
			expected,
		);
		assert.equal(
			countTablesWithDiagonalBorders(
				documentXml(
					`<w:tcPr><w:tcBorders>${border}</w:tcBorders></w:tcPr>${paragraph('A')}`,
				),
			),
			expected,
		);
		cases += 2;
	}
}
assert.equal(cases, 27, 'all cell and diagonal-border regressions executed');
console.log(`Table cells and diagonal borders: ${cases} cases passed.`);
