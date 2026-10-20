import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateSTO } from '@/shared/lib/sto-validator';

export function runFormulaPunctuationTests(): void {
	const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-formula-'));
	const wordDir = path.join(fixtureDir, 'word');
	fs.mkdirSync(wordDir);
	const namespaces =
		'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
	fs.writeFileSync(
		path.join(wordDir, 'styles.xml'),
		`<w:styles ${namespaces}/>`,
	);
	const paragraph = (text: string) =>
		`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
	const mathParagraph = (text: string) =>
		`<w:p><m:oMath><m:r><m:t>${text}</m:t></m:r></m:oMath></w:p>`;
	const table = (content: string) =>
		`<w:tbl><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>`;
	const layoutRow = (text: string, number = '(1)') =>
		`<w:tr><w:tc>${paragraph('')}</w:tc><w:tc>${mathParagraph(text).replace('<w:p>', '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>')}</w:tc><w:tc>${paragraph(number)}</w:tc></w:tr>`;
	const layout = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
	const where = paragraph('где x – переменная.');
	const inlineCodeWhere = (ending: string) =>
		`<w:p><w:r><w:t>где x – переменная </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr><w:t>code</w:t></w:r><w:r><w:t>${ending}</w:t></w:r></w:p>`;
	const checkNames = [
		'Formula Punctuation Before Where',
		'Formula Where Colon',
		'Consecutive Formula Punctuation',
		'Formula Where Definition Separators',
		'Formula Where Final Period',
	] as const;
	let cases = 0;
	const failures: string[] = [];
	const check = (
		name: string,
		body: string,
		failed: readonly string[] = [],
	) => {
		fs.writeFileSync(
			path.join(wordDir, 'document.xml'),
			`<w:document ${namespaces}><w:body>${body}</w:body></w:document>`,
		);
		const results = validateSTO(fixtureDir);
		for (const checkName of checkNames) {
			const result = results.find(item => item.check === checkName);
			assert.ok(result, `Check must execute: ${name}: ${checkName}`);
			if (result.passed !== !failed.includes(checkName)) {
				failures.push(
					`${name}: ${checkName}: expected passed=${!failed.includes(checkName)}, actual=${result.passed}`,
				);
			}
		}
		cases++;
	};
	try {
		const [beforeWhere, colon, consecutive, separators, finalPeriod] =
			checkNames;
		check('period before where', mathParagraph('x=1.') + where, [
			beforeWhere,
		]);
		check('comma before where', mathParagraph('x=1,') + where);
		check(
			'inline code does not hide missing comma',
			mathParagraph('x=1') + inlineCodeWhere('.'),
			[beforeWhere],
		);
		check(
			'inline code retains final period',
			mathParagraph('x=1,') + inlineCodeWhere('.'),
		);
		check(
			'inline code does not hide missing final period',
			mathParagraph('x=1,') + inlineCodeWhere(''),
			[finalPeriod],
		);
		check('no final punctuation', mathParagraph('x=1') + where, [
			beforeWhere,
		]);
		check(
			'display layout table before where',
			layout(layoutRow('x=1.')) + where,
			[beforeWhere],
		);
		check('valid display layout table', layout(layoutRow('x=1,')) + where);
		check(
			'section equation number',
			layout(layoutRow('x=1,', '(2.1)')) + where,
		);
		check(
			'appendix equation number',
			layout(layoutRow('x=1,', '(Б.2)')) + where,
		);
		check(
			'inner fraction comma is not final punctuation',
			'<w:p><m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y,</m:t></m:r></m:den></m:f></m:oMath></w:p>' +
				where,
			[beforeWhere],
		);
		check(
			'comma after number is not expression punctuation',
			layout(layoutRow('x=1', '(1),')) + where,
			[beforeWhere],
		);
		check(
			'punctuation outside OMML before number',
			mathParagraph('x=1').replace(
				'</w:p>',
				'<w:r><w:t>, (1)</w:t></w:r></w:p>',
			) + where,
		);
		check(
			'comma after paragraph number is invalid',
			mathParagraph('x=1').replace(
				'</w:p>',
				'<w:r><w:t>(1),</w:t></w:r></w:p>',
			) + where,
			[beforeWhere],
		);
		check(
			'multiline equation comma',
			'<w:p><m:oMath><m:eqArr><m:e><m:r><m:t>x=1</m:t></m:r></m:e><m:e><m:r><m:t>y=2,</m:t></m:r></m:e></m:eqArr></m:oMath></w:p>' +
				where,
		);
		check(
			'where colon',
			mathParagraph('x=1,') + paragraph('где: x – переменная.'),
			[colon],
		);
		check(
			'consecutive paragraphs missing punctuation',
			mathParagraph('x=1') + mathParagraph('y=2.'),
			[consecutive],
		);
		check(
			'consecutive paragraphs semicolon',
			mathParagraph('x=1;') + mathParagraph('y=2.'),
		);
		check(
			'consecutive layout tables missing punctuation',
			layout(layoutRow('x=1')) + layout(layoutRow('y=2.', '(2)')),
			[consecutive],
		);
		check(
			'consecutive layout tables comma',
			layout(layoutRow('x=1,')) + layout(layoutRow('y=2.', '(2)')),
		);
		check(
			'merged table rows missing punctuation',
			layout(layoutRow('x=1'), layoutRow('y=2.', '(2)')),
			[consecutive],
		);
		check(
			'merged table rows semicolon',
			layout(layoutRow('x=1;'), layoutRow('y=2.', '(2)')),
		);
		check(
			'inline definitions require semicolon',
			mathParagraph('x=1,') +
				paragraph('где x – переменная, y – параметр.'),
			[separators],
		);
		check(
			'inline definitions with semicolon',
			mathParagraph('x=1,') +
				paragraph('где x – переменная; y – параметр.'),
		);
		check(
			'paragraph definitions require semicolon',
			mathParagraph('x=1,') +
				paragraph('где x – переменная') +
				paragraph('y – параметр.'),
			[separators],
		);
		check(
			'paragraph definitions with semicolon',
			mathParagraph('x=1,') +
				paragraph('где x – переменная;') +
				paragraph('y – параметр.'),
		);
		check(
			'internal abbreviation is not final period',
			mathParagraph('x=1,') +
				paragraph('где x – значение в ед. измерения'),
			[finalPeriod],
		);
		check(
			'final abbreviation is final period',
			mathParagraph('x=1,') + paragraph('где x – значение в усл. ед.'),
		);
		check(
			'missing final period',
			mathParagraph('x=1,') + paragraph('где x – переменная'),
			[finalPeriod],
		);
		check(
			'inline OMML symbol definition',
			mathParagraph('x=1,') +
				'<w:p><w:r><w:t>где </w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath><w:r><w:t> – переменная.</w:t></w:r></w:p>',
		);
		check(
			'prose between formula and where',
			mathParagraph('x=1.') + paragraph('Обычный текст.') + where,
		);
		check(
			'where inside prose is not an explanation',
			mathParagraph('x=1.') + paragraph('Пример, где x – переменная.'),
		);
		check(
			'no formula before explanation',
			paragraph('Обычный текст.') + where,
		);
		check(
			'unstructured where prose',
			mathParagraph('x=1.') +
				paragraph('где это значение используется далее.'),
		);
		check(
			'inline prose math is not display formula',
			'<w:p><w:r><w:t>Вычислим </w:t></w:r><m:oMath><m:r><m:t>x=1.</m:t></m:r></m:oMath></w:p>' +
				where,
		);
		check(
			'code paragraph separates flows',
			mathParagraph('x=1') +
				'<w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr><w:t>code</w:t></w:r></w:p>' +
				where,
		);
		check(
			'single-cell data table is a boundary',
			table(mathParagraph('x=1.')) + where,
		);
		check(
			'unrelated data cells do not form explanation',
			`<w:tbl><w:tr><w:tc>${mathParagraph('x=1.')}</w:tc><w:tc>${where}</w:tc></w:tr></w:tbl>`,
		);
		const formulas = Array.from({ length: 174 }, (_, index) => {
			const formula = mathParagraph(`x${index}=1`);
			return (
				(index < 10 ? table(formula) : formula) +
				paragraph('текст '.repeat(250))
			);
		}).join('');
		const dataTables = table(paragraph('Данные')).repeat(9);
		check(
			'174 formulas and 19 tables without where',
			formulas + dataTables,
		);
		assert.deepEqual(
			failures,
			[],
			`${cases} formula punctuation cases executed`,
		);
		console.log(
			`Formula punctuation regressions: ${cases} cases passed, all 5 checks executed per case.`,
		);
	} finally {
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
}

if (require.main === module) {
	runFormulaPunctuationTests();
}
