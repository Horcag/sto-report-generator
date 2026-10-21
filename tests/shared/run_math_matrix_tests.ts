import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import {
	convertLatex2Math,
	convertMathMl2Math,
	mathJaxReady,
} from '../../src/shared/lib/math';
import {
	markMatrixDelimiters,
	restoreMatrixDelimiters,
} from '../../src/shared/lib/math/matrix-delimiters';

const fixture = readFileSync(
	join(__dirname, '../fixtures/wordcraft/matrix-controls.md'),
	'utf8',
);
const cases = [...fixture.matchAll(/^## (.+)\n\n\$\$([\s\S]*?)\$\$/gm)].map(
	match => ({ name: match[1], latex: match[2] }),
);

function children(element: Element, tag: string): Element[] {
	return [...element.children].filter(child => child.tagName === tag);
}

function direct(element: Element, tag: string): Element {
	const matches = children(element, tag);
	assert.equal(matches.length, 1, `Expected one direct ${tag}`);
	return matches[0];
}

function matrixCells(matrix: Element): Element[][] {
	assert.equal(matrix.tagName, 'm:m');
	return children(matrix, 'm:mr').map(row => children(row, 'm:e'));
}

function checkCells(matrix: Element, expected: string[][]): void {
	assert.deepEqual(
		matrixCells(matrix).map(row => row.map(cell => cell.textContent)),
		expected,
	);
}

function numberedCells(rows: number, columns: number): string[][] {
	return Array.from({ length: rows }, (_, row) =>
		Array.from({ length: columns }, (_, column) =>
			String(row * columns + column + 1),
		),
	);
}

function checkDelimiter(formula: Element, begin: string, end: string): Element {
	const delimiter = direct(formula, 'm:d');
	const properties = direct(delimiter, 'm:dPr');
	assert.equal(direct(properties, 'm:begChr').getAttribute('m:val'), begin);
	assert.equal(direct(properties, 'm:endChr').getAttribute('m:val'), end);
	assert.equal(direct(properties, 'm:grow').getAttribute('m:val'), '1');
	assert.equal(formula.getElementsByTagName('m:d').length, 1);
	assert.ok(
		[...formula.getElementsByTagName('m:t')].every(
			run =>
				![...(run.textContent ?? '')].some(char =>
					'[](){}|‖'.includes(char),
				),
		),
		'Delimiters must not be flattened into math text runs',
	);
	return direct(direct(delimiter, 'm:e'), 'm:m');
}

function checkCase(name: string, formula: Element): void {
	const simple =
		/^(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix) (\d+)x(\d+)$/.exec(
			name,
		);
	if (simple) {
		const [, environment, rows, columns] = simple;
		const delimiters: Record<string, [string, string]> = {
			bmatrix: ['[', ']'],
			pmatrix: ['(', ')'],
			Bmatrix: ['{', '}'],
			vmatrix: ['|', '|'],
			Vmatrix: ['‖', '‖'],
		};
		const matrix =
			environment === 'matrix'
				? direct(formula, 'm:m')
				: checkDelimiter(formula, ...delimiters[environment]);
		assert.equal(formula.getElementsByTagName('m:m').length, 1);
		if (environment === 'matrix') {
			assert.equal(formula.getElementsByTagName('m:d').length, 0);
		}
		checkCells(matrix, numberedCells(Number(rows), Number(columns)));
		return;
	}
	if (name === 'Tall fractions and indices') {
		const cells = matrixCells(checkDelimiter(formula, '[', ']'));
		assert.deepEqual(
			cells.map(row => row.length),
			[2, 2],
		);
		assert.equal(formula.getElementsByTagName('m:f').length, 4);
		assert.deepEqual(
			cells.map(row => row.map(cell => cell.textContent)),
			[
				['1xi2', 'ajb3'],
				['c4dk', '5yn6'],
			],
		);
		assert.equal(formula.getElementsByTagName('m:sSubSup').length, 2);
		assert.equal(formula.getElementsByTagName('m:sSub').length, 2);
		assert.equal(formula.getElementsByTagName('m:sSup').length, 2);
		return;
	}
	if (name === 'Nested matrix and array') {
		const outer = checkDelimiter(formula, '[', ']');
		const cells = matrixCells(outer);
		assert.deepEqual(
			cells.map(row => row.length),
			[2, 2],
		);
		checkCells(direct(cells[0][0], 'm:m'), numberedCells(2, 2));
		assert.equal(cells[0][1].textContent, '5');
		assert.equal(cells[1][0].textContent, '6');
		checkCells(direct(cells[1][1], 'm:m'), [
			['7', '8'],
			['9', '10'],
		]);
		assert.equal(formula.getElementsByTagName('m:m').length, 3);
		return;
	}
	if (name === 'Fixed literal brackets') {
		assert.equal(formula.getElementsByTagName('m:d').length, 0);
		checkCells(direct(formula, 'm:m'), numberedCells(2, 2));
		const runs = children(formula, 'm:r');
		assert.deepEqual(
			runs.map(run => run.textContent),
			['[', ']'],
		);
		return;
	}
	const explicit: Record<string, [string, string]> = {
		'Explicit square delimiters': ['[', ']'],
		'Invisible right delimiter': ['{', ''],
		'Invisible left delimiter': ['', ']'],
	};
	assert.ok(explicit[name], `Unknown fixture case: ${name}`);
	checkCells(checkDelimiter(formula, ...explicit[name]), numberedCells(2, 2));
}

async function checkAdjacentExpressions(): Promise<void> {
	const body = String.raw`1&2\\3&4`;
	const matrix = String.raw`\begin{bmatrix}${body}\end{bmatrix}`;
	const collision = '\uE100MATRIX0OPEN\uE101\uE100MATRIXX';
	const collisionMathMl = `<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mtext>${collision}</mtext><mrow data-mjx-texclass="INNER"><mo data-mjx-texclass="OPEN">[</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo data-mjx-texclass="CLOSE">]</mo></mrow></mrow></math>`;
	const expressions = [
		convertLatex2Math(`A=${matrix}x+B`),
		convertLatex2Math(`${matrix}${matrix}`),
		convertLatex2Math(String.raw`\left(\sum_{i=1}^{n}x_i+${matrix}\right)`),
		convertMathMl2Math(collisionMathMl),
		convertLatex2Math(`[${matrix})`),
	];
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: expressions.map(
						math => new Paragraph({ children: [math] }),
					),
				},
			],
		}),
	);
	const xml = new AdmZip(buffer)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(xml);
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	const formulas = [...document.getElementsByTagName('m:oMath')];
	assert.equal(formulas.length, 5);
	checkCells(checkDelimiter(formulas[0], '[', ']'), numberedCells(2, 2));
	assert.equal(formulas[0].textContent, 'A=1234x+B');
	assert.deepEqual(
		[...formulas[0].children].map(child => child.tagName),
		['m:r', 'm:d', 'm:r'],
	);
	const adjacent = children(formulas[1], 'm:d');
	assert.equal(adjacent.length, 2);
	for (const delimiter of adjacent) {
		checkCells(
			direct(direct(delimiter, 'm:e'), 'm:m'),
			numberedCells(2, 2),
		);
	}
	assert.equal(formulas[1].textContent, '12341234');
	const outer = direct(formulas[2], 'm:d');
	const outerProperties = direct(outer, 'm:dPr');
	assert.equal(
		direct(outerProperties, 'm:begChr').getAttribute('m:val'),
		'(',
	);
	assert.equal(
		direct(outerProperties, 'm:endChr').getAttribute('m:val'),
		')',
	);
	assert.equal(direct(outerProperties, 'm:grow').getAttribute('m:val'), '1');
	const outerExpression = direct(outer, 'm:e');
	checkCells(checkDelimiter(outerExpression, '[', ']'), numberedCells(2, 2));
	assert.equal(outerExpression.getElementsByTagName('m:nary').length, 1);
	assert.equal(outerExpression.getElementsByTagName('m:sSub').length, 1);
	assert.equal(outerExpression.textContent, 'i=1nxi+1234');
	checkCells(checkDelimiter(formulas[3], '[', ']'), numberedCells(2, 2));
	assert.equal(formulas[3].textContent, `${collision}1234`);
	const mixed = direct(formulas[4], 'm:d');
	checkCells(direct(direct(mixed, 'm:e'), 'm:m'), numberedCells(2, 2));
	assert.equal(formulas[4].getElementsByTagName('m:d').length, 1);
	assert.equal(formulas[4].textContent, '[1234)');
	assert.deepEqual(
		children(formulas[4], 'm:r').map(run => run.textContent),
		['[', ')'],
	);
	for (const formula of formulas.filter((_, index) => index !== 3)) {
		assert.ok(
			!formula.textContent?.includes('\uE100MATRIX'),
			'Internal markers leaked',
		);
	}
	console.log(
		'PASS adjacency, nested fences, marker collision, and mixed literal brackets',
	);
}

function checkStyledMarkerRuns(): void {
	const source = new JSDOM(
		'<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow data-mjx-texclass="INNER"><mo data-mjx-texclass="OPEN">[</mo><mtable><mtr><mtd><mn>1</mn></mtd></mtr></mtable><mo data-mjx-texclass="CLOSE">]</mo></mrow></math>',
		{ contentType: 'text/xml' },
	).window.document;
	const descriptors = markMatrixDelimiters(source);
	assert.equal(descriptors.length, 1);
	const [{ open, close }] = descriptors;
	const style = '<w:rPr><w:color w:val="C00000"/><w:sz w:val="40"/></w:rPr>';
	const matrix = '<m:m><m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e></m:mr></m:m>';
	const xml = `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><m:r>${style}<m:t>A=${open}</m:t></m:r>${matrix}<m:r>${style}<m:t>${close}x+B</m:t></m:r></m:oMath>`;
	const restored = restoreMatrixDelimiters(xml, descriptors);
	const formula = new JSDOM(restored, { contentType: 'text/xml' }).window
		.document.documentElement;
	checkCells(checkDelimiter(formula, '[', ']'), [['1']]);
	assert.equal(formula.textContent, 'A=1x+B');
	const delimiterProperties = direct(direct(formula, 'm:d'), 'm:dPr');
	const control = direct(delimiterProperties, 'm:ctrlPr');
	const propertySets = [
		direct(control, 'w:rPr'),
		...children(formula, 'm:r').map(run => direct(run, 'w:rPr')),
	];
	assert.equal(
		propertySets.length,
		3,
		'Both adjacent runs must keep their properties',
	);
	for (const properties of propertySets) {
		assert.equal(
			direct(properties, 'w:color').getAttribute('w:val'),
			'C00000',
		);
		assert.equal(direct(properties, 'w:sz').getAttribute('w:val'), '40');
	}
	assert.ok(!restored.includes('\uE100MATRIX'));
	console.log('PASS styled delimiter controls and adjacent run properties');
}

async function main(): Promise<void> {
	await mathJaxReady();
	assert.equal(cases.length, 18, 'Every public matrix control must execute');
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: cases.map(
						({ latex }) =>
							new Paragraph({
								children: [convertLatex2Math(latex)],
							}),
					),
				},
			],
		}),
	);
	const xml = new AdmZip(buffer)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(xml);
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	assert.equal(document.getElementsByTagName('parsererror').length, 0);
	assert.equal(document.getElementsByTagName('undefined').length, 0);
	const formulas = [...document.getElementsByTagName('m:oMath')];
	assert.equal(formulas.length, cases.length);
	const failures: string[] = [];
	for (const [index, { name }] of cases.entries()) {
		try {
			checkCase(name, formulas[index]);
			console.log(`PASS ${name}`);
		} catch (error) {
			failures.push(name);
			console.error(`FAIL ${name}: ${String(error)}`);
		}
	}
	assert.deepEqual(failures, [], 'Native matrix controls failed');
	await checkAdjacentExpressions();
	checkStyledMarkerRuns();
	console.log(
		`Matrix OMML tests passed (${cases.length} fixture + 6 regression cases).`,
	);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
