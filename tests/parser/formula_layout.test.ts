import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';
import { JSDOM } from 'jsdom';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { splitDisplayMathLines } from '@/shared/lib/math/display-lines';
import { validateSourceFormulas } from '@/shared/lib/source-preflight/formula-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';
import { validateFormulaPunctuation } from '@/shared/lib/sto-validator/math-xml';

async function run(): Promise<void> {
	const fixtureIssues: SourcePreflightIssue[] = [];
	validateSourceFormulas(
		'layout.md',
		readFileSync(
			path.join(__dirname, '../fixtures/formulas/layout.md'),
			'utf8',
		),
		fixtureIssues,
	);
	assert.deepEqual(
		fixtureIssues,
		[],
		'native corpus must also pass formula source rules',
	);
	const children = await parseMarkdownToDocx(
		String.raw`По формуле @eq:tall и повторно (@eq:tall). Ещё (*@eq:tall*) и ( @eq:tall ).

$$B=\frac{1}{N}\sum_{i=1}^{N}(p_i-y_i)^2, (@eq:tall)$$`,
		{},
	);
	const bytes = await Packer.toBuffer(
		new Document({ sections: [{ children }] }),
	);
	const document = new JSDOM(
		new AdmZip(bytes).readAsText('word/document.xml'),
		{
			contentType: 'text/xml',
		},
	).window.document;
	const cells = [...document.getElementsByTagName('w:tc')];
	assert.equal(cells.length, 3);
	const number = cells[2];
	assert.equal(
		number.getElementsByTagName('w:vAlign')[0]?.getAttribute('w:val'),
		'center',
		'tall equation number must be vertically centered',
	);
	assert.equal(
		number.getElementsByTagName('w:jc')[0]?.getAttribute('w:val'),
		'right',
	);
	assert.equal(
		number.getElementsByTagName('w:right')[0]?.getAttribute('w:w'),
		'0',
		'number reaches the text margin',
	);
	for (const cell of cells) {
		const indent = cell.getElementsByTagName('w:ind')[0];
		assert.equal(
			indent?.getAttribute('w:firstLine'),
			'0',
			'do not inherit body first-line indent',
		);
	}
	assert.equal(
		document.getElementsByTagName('w:cantSplit').length,
		1,
		'formula and number stay on one page',
	);
	const text = [...document.getElementsByTagName('w:t')]
		.map(node => node.textContent)
		.join('');
	assert.ok(text.includes('По формуле (1) и повторно (1).'), text);
	assert.ok(!text.includes('((1))'));
	assert.ok(text.includes('Ещё (1) и ( 1 ).'), text);
	const continuations = [
		[String.raw`a=b+\\+c.`, ['a=b+', '+c.']],
		[String.raw`\begin{aligned}a&=b+\\&+c.\end{aligned}`, ['a=b+', '+c.']],
		[String.raw`\begin{gathered}a=b+\\+c\end{gathered},`, ['a=b+', '+c,']],
		[
			String.raw`A=\begin{bmatrix}1&2\\3&4\end{bmatrix}.`,
			[String.raw`A=\begin{bmatrix}1&2\\3&4\end{bmatrix}.`],
		],
		[
			String.raw`f=\begin{cases}a,&x>0\\b,&x<0\end{cases}.`,
			[String.raw`f=\begin{cases}a,&x>0\\b,&x<0\end{cases}.`],
		],
	] as const;
	for (const [source, expected] of continuations)
		assert.deepEqual(splitDisplayMathLines(source), expected);
	const adjacent = String.raw`\begin{aligned}a&=b\end{aligned}+\begin{aligned}c&=d\end{aligned}`;
	assert.deepEqual(splitDisplayMathLines(adjacent), [adjacent]);
	assert.deepEqual(
		splitDisplayMathLines(
			String.raw`\begin{aligned}a&=b % ignored \\ x=999` +
				'\n' +
				String.raw`\\&=c\end{aligned}`,
		),
		['a=b', '=c'],
	);
	assert.deepEqual(splitDisplayMathLines(String.raw`a=100\%+b`), [
		String.raw`a=100\%+b`,
	]);
	for (const source of [
		String.raw`a=b\\[2pt]+c`,
		String.raw`a=b\\*+c`,
		String.raw`\begin{aligned}[t]a&=b\end{aligned}`,
	])
		assert.throws(() => splitDisplayMathLines(source), /not supported/);
	assert.throws(
		() => splitDisplayMathLines(String.raw`a=b\\`),
		/empty continuation/,
	);
	const multiline = await parseMarkdownToDocx(
		String.raw`$$\begin{aligned}a&=b+\\&+c.\end{aligned} (@eq:multi)$$`,
		{},
	);
	const multiBytes = await Packer.toBuffer(
		new Document({ sections: [{ children: multiline }] }),
	);
	const multiDoc = new JSDOM(
		new AdmZip(multiBytes).readAsText('word/document.xml'),
		{ contentType: 'text/xml' },
	).window.document;
	const rows = [...multiDoc.getElementsByTagName('w:tr')];
	assert.equal(
		rows.length,
		2,
		'explicit continuation remains two physical rows',
	);
	assert.equal(rows[0].getElementsByTagName('w:tc')[2].textContent, '');
	assert.equal(
		rows[1].getElementsByTagName('w:tc')[2].textContent,
		'(1)',
		'only last continuation has the number',
	);
	assert.equal(multiDoc.getElementsByTagName('m:oMath').length, 2);
	for (const source of [
		'$$x=y, (@eq:where)$$\n\nгде $x$ – величина.',
		'$$x=y, (@eq:where)$$\n\n<!-- note -->\n\nгде $x$ – величина.',
		'$$x=y, (@eq:where)$$\nгде $x$ – величина.',
		String.raw`$$x=y+\\+z, (@eq:where)$$` + '\n\nгде $x$ – величина.',
	]) {
		const whereChildren = await parseMarkdownToDocx(source, {});
		const whereBytes = await Packer.toBuffer(
			new Document({ sections: [{ children: whereChildren }] }),
		);
		const whereDoc = new JSDOM(
			new AdmZip(whereBytes).readAsText('word/document.xml'),
			{ contentType: 'text/xml' },
		).window.document;
		const table = whereDoc.getElementsByTagName('w:tbl')[0];
		assert.equal(
			table.getElementsByTagName('w:keepNext').length,
			table.getElementsByTagName('w:tr').length * 3,
			'all formula cell paragraphs keep the explanation on the same page',
		);
		assert.ok(
			[...table.getElementsByTagName('w:keepNext')].every(
				value => value.getAttribute('w:val') !== 'false',
			),
		);
		assert.deepEqual(
			validateFormulaPunctuation(
				whereDoc.documentElement.outerHTML,
			).filter(result => !result.passed),
			[],
		);
	}
	for (const following of ['Обычный абзац.', 'где-то в тексте.']) {
		const children = await parseMarkdownToDocx(
			`$$x=y. (@eq:plain)$$\n\n${following}`,
			{},
		);
		const bytes = await Packer.toBuffer(
			new Document({ sections: [{ children }] }),
		);
		const document = new JSDOM(
			new AdmZip(bytes).readAsText('word/document.xml'),
			{ contentType: 'text/xml' },
		).window.document;
		const table = document.getElementsByTagName('w:tbl')[0];
		assert.ok(
			[...table.getElementsByTagName('w:keepNext')].every(
				node => node.getAttribute('w:val') === 'false',
			),
			'an ordinary paragraph must not attach to the formula',
		);
	}
	assert.deepEqual(
		validateFormulaPunctuation(multiDoc.documentElement.outerHTML).filter(
			result => !result.passed,
		),
		[],
		'continuation rows are one formula for punctuation validation',
	);
	console.log(
		'Formula layout regression: tall number, right margin, indents, page cohesion and references passed.',
	);
}

run().catch(error => {
	console.error(error);
	process.exit(1);
});
