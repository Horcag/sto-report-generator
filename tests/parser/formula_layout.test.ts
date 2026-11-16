import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';
import { JSDOM } from 'jsdom';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_STYLES } from '@/shared/config';
import { splitDisplayMathLines } from '@/shared/lib/math/display-lines';
import { validateSourceFormulas } from '@/shared/lib/source-preflight/formula-checker';
import { SourcePreflightIssue } from '@/shared/lib/source-preflight/types';
import { validateSTO } from '@/shared/lib/sto-validator';
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
		new Document({ styles: STO_STYLES, sections: [{ children }] }),
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
	for (const source of [
		String.raw`G=I[y\in[0{,}4081H;0{,}9919H],\qquad x\in[0{,}0359W;0{,}9641W]],`,
		String.raw`\delta_j=\left\|p_j-q_j\right\|,\qquad j\in\{1,2,3\},`,
		String.raw`a=b+\\+c.`,
	]) {
		const unnumbered = await parseMarkdownToDocx(`$$${source}$$`, {});
		const packed = await Packer.toBuffer(
			new Document({ sections: [{ children: unnumbered }] }),
		);
		const xml = new AdmZip(packed).readAsText('word/document.xml');
		const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
		const rows = [...doc.getElementsByTagName('w:tr')];
		assert.equal(rows.length, source.includes('\\\\') ? 2 : 1);
		for (const row of rows) {
			const cells = [...row.getElementsByTagName('w:tc')];
			assert.equal(
				cells.length,
				1,
				'unnumbered formula uses the full text width',
			);
			assert.equal(
				cells[0].getElementsByTagName('w:tcW')[0]?.getAttribute('w:w'),
				'5000',
			);
			assert.equal(
				cells[0].getElementsByTagName('w:jc')[0]?.getAttribute('w:val'),
				'center',
			);
		}
	}
	for (const [source, continuation] of [
		['$$x=y,$$\n\nа при альтернативном условии результат иной.', true],
		[
			'$$x=y, (@eq:continued)$$\n\nа при альтернативном условии результат иной.',
			true,
		],
		['$$x=y,$$\nа при альтернативном условии результат иной.', true],
		[
			'$$x=y,$$\n\n<!-- comment -->\n\nа при альтернативном условии результат иной.',
			true,
		],
		['$$x=y,$$\n\n*а* это продолжение.', true],
		['$$x=y,$$\n\n$z$ задаёт значение.', false],
		['$$x=y,$$\n\nНовый абзац.', false],
		['$$x=y.$$\n\nа это отдельный абзац.', false],
		['$$x=y,$$\n\n# Заголовок\n\nа это отдельный абзац.', false],
		['$$x=y,$$\n\n```text\nbarrier\n```\n\nа это отдельный абзац.', false],
		['$$x=y,$$\n\n<div>barrier</div>\n\nа это отдельный абзац.', false],
		['$$x=y,$$\n\nПромежуточный абзац.\n\nа это отдельный абзац.', false],
	] as const) {
		const children = await parseMarkdownToDocx(source, {});
		const packed = await Packer.toBuffer(
			new Document({ styles: STO_STYLES, sections: [{ children }] }),
		);
		const unpacked = fs.mkdtempSync(
			path.join(os.tmpdir(), 'formula-continuation-'),
		);
		try {
			const zip = new AdmZip(packed);
			zip.extractAllTo(unpacked);
			const result = validateSTO(unpacked).find(
				item => item.check === 'Direct Body Paragraph Formatting',
			);
			assert.equal(result?.passed, true, source);
		} finally {
			fs.rmSync(unpacked, { recursive: true, force: true });
		}
		const doc = new JSDOM(
			new AdmZip(packed).readAsText('word/document.xml'),
			{ contentType: 'text/xml' },
		).window.document;
		const paragraphs = [
			...doc.getElementsByTagName('w:body')[0].children,
		].filter(node => node.tagName === 'w:p');
		const last = paragraphs.at(-1)!;
		assert.equal(
			last
				.getElementsByTagName('w:ind')[0]
				?.getAttribute('w:firstLine') === '0',
			continuation,
			source,
		);
	}
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
	for (const outer of ['aligned', 'gathered']) {
		const matrix = String.raw`\begin{matrix}a&b&c\\d&e&f\end{matrix}`;
		const system = String.raw`\left\{\begin{aligned}a&=b&c&=d\\e&=f&g&=h\end{aligned}\right.`;
		for (const nested of [matrix, system, String.raw`\text{a&b&c}`])
			assert.deepEqual(
				splitDisplayMathLines(
					`\\begin{${outer}}x&=${nested}\\\\&=z\\end{${outer}}`,
				),
				[`x=${nested}`, '=z'],
			);
		assert.deepEqual(
			splitDisplayMathLines(
				`\\begin{${outer}}a\\&b&=c\\&d\\\\&=e\\end{${outer}}`,
			),
			[String.raw`a\&b=c\&d`, '=e'],
		);
		for (const row of [
			'a&=b&c&=d',
			String.raw`a&=b\\c&=d&e`,
			String.raw`a\&b&=c&d`,
		])
			assert.throws(
				() =>
					splitDisplayMathLines(
						`\\begin{${outer}}${row}\\end{${outer}}`,
					),
				/multiple top-level alignment markers.*not supported/i,
			);
	}
	const unsupportedColumns = String.raw`$$\begin{aligned}a&=b&c&=d\end{aligned} (@eq:columns)$$`;
	const alignmentIssues: SourcePreflightIssue[] = [];
	validateSourceFormulas('columns.md', unsupportedColumns, alignmentIssues);
	assert.ok(
		alignmentIssues.some(
			issue =>
				issue.code === 'formula-unsupported-continuation' &&
				issue.severity === 'error' &&
				/multiple top-level alignment markers/i.test(issue.message),
		),
		'preflight must reject unsupported columns before rendering',
	);
	await assert.rejects(
		parseMarkdownToDocx(unsupportedColumns, {}),
		/multiple top-level alignment markers.*not supported/i,
	);
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
			new Document({ styles: STO_STYLES, sections: [{ children }] }),
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
