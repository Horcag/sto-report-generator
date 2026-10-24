import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { validateFormulaLayout } from '@/shared/lib/math/formula-layout-validator';

const NAMESPACES =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const CHECKS = [
	'Formula Horizontal Alignment',
	'Formula Number Vertical Alignment',
	'Formula Number Horizontal Alignment',
	'Formula Paragraph Indents',
	'Formula Number Upright',
	'Formula Number Right Margin',
] as const;

const math = '<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath>';
const fraction =
	'<m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath>';
const paragraph = (content: string, alignment: string) =>
	`<w:p><w:pPr><w:jc w:val="${alignment}"/><w:ind w:left="0" w:right="0" w:firstLine="0" w:hanging="0"/></w:pPr>${content}</w:p>`;
const row = (number = '(1)', formula = math) =>
	`<w:tr><w:tc><w:p/></w:tc><w:tc>${paragraph(`<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${formula}</m:oMathPara>`, 'center')}</w:tc><w:tc><w:tcPr><w:tcMar><w:right w:w="0" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>${paragraph(`<w:r><w:t>${number}</w:t></w:r>`, 'right')}</w:tc></w:tr>`;
const table = (...rows: string[]) =>
	`<w:tbl><w:tblPr><w:tblBorders><w:top w:val="none"/><w:bottom w:val="nil"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl>`;
const documentXml = (body: string) =>
	`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`;

export async function runFormulaLayoutTests(): Promise<void> {
	let cases = 0;
	const check = (
		name: string,
		body: string,
		failed: readonly string[] = [],
	) => {
		const results = validateFormulaLayout(documentXml(body));
		assert.deepEqual(
			results.map(result => result.check),
			CHECKS,
			`${name}: all six checks execute exactly once`,
		);
		assert.deepEqual(
			results
				.filter(result => !result.passed)
				.map(result => result.check),
			failed,
			name,
		);
		for (const result of results.filter(result => !result.passed)) {
			assert.match(
				result.error ?? '',
				/word\/document\.xml: table \d+, row \d+/,
				`${name}: failure locates table and row`,
			);
		}
		cases++;
	};
	const valid = table(row());
	check('ordinary equation', valid);
	check('tall fraction', table(row('(2)', fraction)));
	check('section equation number', table(row('(2.1)')));
	check('appendix equation number', table(row('(Б.2)')));
	check('unnumbered equation', table(row('')));
	check('merged wrapper rows', table(row(), row('(2)', fraction)));
	check('multiline number on last row', table(row(''), row('(3)')));
	check(
		'multiline merged with adjacent equation',
		table(row(''), row('(3)'), row('(4)', fraction)),
	);
	check(
		'legacy missing vertical alignment',
		valid.replace('<w:vAlign w:val="center"/>', ''),
		[CHECKS[1]],
	);
	check(
		'tall formula missing vertical alignment',
		table(row('(2)', fraction)).replace('<w:vAlign w:val="center"/>', ''),
		[CHECKS[1]],
	);
	check(
		'top aligned tall formula number',
		table(row('(2)', fraction)).replace(
			'w:vAlign w:val="center"',
			'w:vAlign w:val="top"',
		),
		[CHECKS[1]],
	);
	check(
		'merged second row is checked',
		table(
			row(),
			row('(2)').replace(
				'w:vAlign w:val="center"',
				'w:vAlign w:val="bottom"',
			),
		),
		[CHECKS[1]],
	);
	check(
		'formula paragraph alignment',
		valid.replace('w:val="center"', 'w:val="left"'),
		[CHECKS[0]],
	);
	check(
		'display math alignment',
		valid.replace('m:val="center"', 'm:val="left"'),
		[CHECKS[0]],
	);
	check(
		'display math missing alignment',
		valid.replace('<m:jc m:val="center"/>', ''),
		[CHECKS[0]],
	);
	check(
		'number left alignment',
		valid.replace('w:val="right"', 'w:val="left"'),
		[CHECKS[2]],
	);
	check(
		'number missing alignment',
		valid.replace('<w:jc w:val="right"/>', ''),
		[CHECKS[2]],
	);
	for (const attribute of ['firstLine', 'hanging', 'left', 'right']) {
		check(
			`formula ${attribute} indent`,
			valid.replace(`w:${attribute}="0"`, `w:${attribute}="200"`),
			[CHECKS[3]],
		);
	}
	check(
		'number paragraph indent',
		valid.replace(
			'w:val="right"/><w:ind w:left="0"',
			'w:val="right"/><w:ind w:left="100"',
		),
		[CHECKS[3]],
	);
	check(
		'ordinary number italic',
		valid.replace('<w:t>(1)</w:t>', '<w:rPr><w:i/></w:rPr><w:t>(1)</w:t>'),
		[CHECKS[4]],
	);
	check(
		'italic disabled explicitly',
		valid.replace(
			'<w:t>(1)</w:t>',
			'<w:rPr><w:i w:val="false"/></w:rPr><w:t>(1)</w:t>',
		),
	);
	check(
		'math number default italic',
		valid.replace(
			'<w:r><w:t>(1)</w:t></w:r>',
			'<m:oMath><m:r><m:t>(1)</m:t></m:r></m:oMath>',
		),
		[CHECKS[4]],
	);
	check(
		'math number upright',
		valid.replace(
			'<w:r><w:t>(1)</w:t></w:r>',
			'<m:oMath><m:r><m:rPr><m:nor/></m:rPr><m:t>(1)</m:t></m:r></m:oMath>',
		),
	);
	check(
		'right number margin',
		valid.replace('w:right w:w="0"', 'w:right w:w="108"'),
		[CHECKS[5]],
	);
	check(
		'omitted right margin',
		valid.replace('<w:tcMar><w:right w:w="0" w:type="dxa"/></w:tcMar>', ''),
	);
	check(
		'table right margin inherited',
		valid
			.replace(
				'</w:tblPr>',
				'<w:tblCellMar><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>',
			)
			.replace('<w:tcMar><w:right w:w="0" w:type="dxa"/></w:tcMar>', ''),
		[CHECKS[5]],
	);
	check(
		'cell right margin overrides table margin',
		valid.replace(
			'</w:tblPr>',
			'<w:tblCellMar><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>',
		),
	);
	check('no formulas are required', '<w:p><w:r><w:t>Text</w:t></w:r></w:p>');
	check(
		'visible data table excluded',
		valid
			.replace('w:val="none"', 'w:val="single"')
			.replace('<w:vAlign w:val="center"/>', ''),
	);
	check(
		'data table with math and text excluded',
		valid
			.replace(
				'<m:oMathPara>',
				'<w:r><w:t>Measured result</w:t></w:r><m:oMathPara>',
			)
			.replace('<w:vAlign w:val="center"/>', ''),
	);
	check(
		'nonempty left data cell excluded',
		valid
			.replace(
				'<w:tc><w:p/></w:tc>',
				'<w:tc><w:p><w:r><w:t>Data</w:t></w:r></w:p></w:tc>',
			)
			.replace('<w:vAlign w:val="center"/>', ''),
	);
	check(
		'nested formula table excluded',
		table(
			`<w:tr><w:tc>${valid.replace('<w:vAlign w:val="center"/>', '')}</w:tc></w:tr>`,
		),
	);
	check(
		'bare legacy math checks paragraph centering',
		table(
			row()
				.replace(
					'<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>',
					'',
				)
				.replace('</m:oMathPara>', ''),
		),
	);
	check(
		'border properties omitted by Word',
		valid.replace(
			'<w:tblBorders><w:top w:val="none"/><w:bottom w:val="nil"/></w:tblBorders>',
			'',
		),
	);
	assert.equal(cases, 37, 'all synthetic cases discovered');
	const children = await parseMarkdownToDocx(
		String.raw`$$x=1 (1)$$

$$\frac{x}{y} (2)$$`,
		{},
	);
	const buffer = await Packer.toBuffer(
		new Document({ sections: [{ children }] }),
	);
	const generated = new AdmZip(buffer).readAsText('word/document.xml');
	assert.equal(
		(generated.match(/<w:tbl>/g) ?? []).length,
		2,
		'actual parser fixture contains both wrapper tables',
	);
	assert.deepEqual(
		validateFormulaLayout(generated).filter(result => !result.passed),
		[],
		'actual parser produces valid ordinary and tall formula layouts',
	);
	console.log(
		`Formula layout regressions: ${cases} synthetic cases and 2 generated equations passed; all 6 checks executed per case. Fixtures remained in memory.`,
	);
}

if (require.main === module) {
	runFormulaLayoutTests().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
