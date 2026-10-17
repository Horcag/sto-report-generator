import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateSTO } from '@/shared/lib/sto-validator';

export function runMathLayoutTableTests(): void {
	const fixtureDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-math-table-'),
	);
	const wordDir = path.join(fixtureDir, 'word');
	fs.mkdirSync(wordDir);
	const namespaces =
		'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
	fs.writeFileSync(
		path.join(wordDir, 'styles.xml'),
		`<w:styles ${namespaces}/>`,
	);
	const math = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
	const paragraph = (content: string) => `<w:p>${content}</w:p>`;
	const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
	const cell = (content: string) => `<w:tc>${paragraph(content)}</w:tc>`;
	const row = (content: string) => `<w:tr>${content}</w:tr>`;
	const table = (content: string, properties = '') =>
		`<w:tbl><w:tblPr>${properties}</w:tblPr>${content}</w:tbl>`;
	const layout = table(
		row(
			cell('') +
				cell('<w:pPr><w:jc w:val="center"/></w:pPr>' + math) +
				cell(text('(1)')),
		),
		'<w:tblBorders><w:top w:val="none"/><w:bottom w:val="none"/><w:left w:val="none"/><w:right w:val="none"/></w:tblBorders>',
	);
	const layoutRow = /<w:tr\b[\s\S]*?<\/w:tr>/.exec(layout)?.[0];
	assert.ok(layoutRow);
	const mergedLayout = layout.replace('</w:tbl>', layoutRow + '</w:tbl>');
	const validate = (body: string) => {
		fs.writeFileSync(
			path.join(wordDir, 'document.xml'),
			`<w:document ${namespaces}><w:body>${body}</w:body></w:document>`,
		);
		return validateSTO(fixtureDir);
	};
	const checks = [
		'Table Caption Adjacency',
		'Table Header Repeat',
		'Table Cell Padding',
		'Table Header Final Period',
		'Table Diagonal Borders',
	];
	try {
		const dataTable = table(
			row(cell(math) + cell(text('Время.'))) +
				row(cell(text('1')) + cell(text('2'))),
			'<w:tblBorders><w:tl2br w:val="single"/></w:tblBorders>',
		);
		const dataResults = validate(dataTable);
		for (const check of checks) {
			const result = dataResults.find(item => item.check === check);
			assert.ok(result, `Data table check must execute: ${check}`);
			assert.equal(
				result.passed,
				false,
				`Inline math cannot bypass ${check}`,
			);
		}
		assert.equal(
			dataResults.find(item => item.check === 'Empty Table Cells')
				?.passed,
			true,
			'A math-only data cell contains visible content',
		);
		for (const [name, wrapper] of [
			['generated', layout],
			['word-merged two-row', mergedLayout],
			[
				'word-normalized',
				layout
					.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/, '')
					.replaceAll('<w:pPr>', '<w:pPr><w:pStyle w:val="a42"/>'),
			],
		] as const) {
			const results = validate(wrapper);
			for (const check of [...checks, 'Empty Table Cells']) {
				assert.equal(
					results.find(item => item.check === check)?.passed,
					true,
					`${name} display wrapper is exempt from ${check}`,
				);
			}
		}
		const mixedRows = layout.replace(
			'</w:tbl>',
			row(cell(text('Заголовок')) + cell(math) + cell(text('1'))) +
				'</w:tbl>',
		);
		for (const [name, wrapper] of [
			['mixed formula and data rows', mixedRows],
			[
				'table with repeated header',
				mergedLayout.replace(
					'<w:tr>',
					'<w:tr><w:trPr><w:tblHeader/></w:trPr>',
				),
			],
		] as const) {
			assert.equal(
				validate(wrapper).find(
					item => item.check === 'Table Caption Adjacency',
				)?.passed,
				false,
				`${name} cannot use the display-layout exemption`,
			);
		}
		const borderedLayout = layout.replace('w:val="none"', 'w:val="single"');
		assert.equal(
			validate(borderedLayout).find(
				item => item.check === 'Table Caption Adjacency',
			)?.passed,
			false,
			'A visible border prevents the display-layout exemption',
		);
		console.log('Math table classification regressions passed.');
	} finally {
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
}

if (require.main === module) {
	runMathLayoutTableTests();
}
