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
	const where = paragraph('где x – переменная.');
	const check = (name: string, body: string, passed: boolean) => {
		fs.writeFileSync(
			path.join(wordDir, 'document.xml'),
			`<w:document ${namespaces}><w:body>${body}</w:body></w:document>`,
		);
		const result = validateSTO(fixtureDir).find(
			item => item.check === 'Formula Punctuation Before Where',
		);
		assert.ok(result, `Formula punctuation check must execute: ${name}`);
		assert.equal(result.passed, passed, name);
	};
	try {
		check('period before where', mathParagraph('x=1.') + where, false);
		check('comma before where', mathParagraph('x=1,') + where, true);
		check('no final punctuation', mathParagraph('x=1') + where, true);
		check(
			'display layout table before where',
			table(mathParagraph('x=1.')) + where,
			false,
		);
		check(
			'prose between formula and where',
			mathParagraph('x=1.') + paragraph('Обычный текст.') + where,
			true,
		);
		check(
			'where inside prose is not an explanation',
			mathParagraph('x=1.') + paragraph('Пример, где x – переменная.'),
			true,
		);
		check(
			'no formula before explanation',
			paragraph('Обычный текст.') + where,
			true,
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
			true,
		);
		console.log('Formula punctuation regressions: 8 cases passed.');
	} finally {
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	}
}

if (require.main === module) {
	runFormulaPunctuationTests();
}
