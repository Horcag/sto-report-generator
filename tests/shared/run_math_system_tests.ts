import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import { convertLatex2Math, mathJaxReady } from '@/shared/lib/math';
import {
	collectMatrixAlignments,
	restoreMatrixAlignments,
} from '@/shared/lib/math/matrix-alignment';

import { runMatrixSpacingTests } from './matrix_spacing.test';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const cases = [
	{
		name: 'three cases with tall fractions and distinct long conditions',
		latex: String.raw`f(x)=\begin{cases}\frac{a}{b}&\text{when a is negative}\\c&\text{when a belongs to a much longer interval}\\d&\text{otherwise}\end{cases}`,
		matrices: [
			{
				alignment: ['left', 'left'],
				cells: [
					['ab', 'when a is negative'],
					['c', 'when a belongs to a much longer interval'],
					['d', 'otherwise'],
				],
			},
		],
	},
	{
		name: 'aligned system inside one-sided delimiter',
		latex: String.raw`\left\{\begin{aligned}x&=a\\y&=\frac{b}{c}\\z&=d\end{aligned}\right.`,
		matrices: [
			{
				alignment: ['right', 'left'],
				cells: [
					['x', '=a'],
					['y', '=bc'],
					['z', '=d'],
				],
			},
		],
	},
	{
		name: 'array right left',
		latex: String.raw`\begin{array}{rl}a&b\\c&d\\e&f\end{array}`,
		matrices: [
			{
				alignment: ['right', 'left'],
				cells: [
					['a', 'b'],
					['c', 'd'],
					['e', 'f'],
				],
			},
		],
	},
	{
		name: 'three column array',
		latex: String.raw`\begin{array}{lcr}a&b&c\\d&e&f\\g&h&i\end{array}`,
		matrices: [
			{
				alignment: ['left', 'center', 'right'],
				cells: [
					['a', 'b', 'c'],
					['d', 'e', 'f'],
					['g', 'h', 'i'],
				],
			},
		],
	},
	{
		name: 'default matrix remains centered',
		latex: String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
		matrices: [
			{
				alignment: ['center', 'center'],
				cells: [
					['a', 'b'],
					['c', 'd'],
				],
			},
		],
	},
	{
		name: 'nested case matrix order and different alignment',
		latex: String.raw`\begin{cases}\begin{matrix}1&2\\3&4\end{matrix}&a\\b&c\end{cases}`,
		matrices: [
			{
				alignment: ['left', 'left'],
				cells: [
					['1234', 'a'],
					['b', 'c'],
				],
			},
			{
				alignment: ['center', 'center'],
				cells: [
					['1', '2'],
					['3', '4'],
				],
			},
		],
	},
	{
		name: 'nested arrays preserve independent alignment',
		latex: String.raw`\begin{array}{rl}\begin{array}{lcr}a&b&c\end{array}&d\\e&f\end{array}`,
		matrices: [
			{
				alignment: ['right', 'left'],
				cells: [
					['abc', 'd'],
					['e', 'f'],
				],
			},
			{
				alignment: ['left', 'center', 'right'],
				cells: [['a', 'b', 'c']],
			},
		],
	},
];

function children(element: Element, tag: string): Element[] {
	return [...element.children].filter(child => child.tagName === tag);
}

function expandedAlignment(matrix: Element): string[] {
	const properties = children(matrix, 'm:mPr');
	assert.equal(properties.length, 1, 'exactly one matrix property container');
	const columns = children(properties[0], 'm:mcs');
	assert.equal(
		columns.length,
		1,
		'old center-only columns replaced exactly once',
	);
	return children(columns[0], 'm:mc').flatMap(column => {
		const group = children(column, 'm:mcPr')[0];
		const count = Number(
			children(group, 'm:count')[0]?.getAttribute('m:val'),
		);
		assert.ok(
			Number.isInteger(count) && count > 0,
			'column group has explicit positive count',
		);
		return Array.from(
			{ length: count },
			() => children(group, 'm:mcJc')[0]?.getAttribute('m:val') ?? '',
		);
	});
}

function runAlignmentGuards(): void {
	const source = new JSDOM(
		`<math xmlns="${MATHML_NS}"><mtable columnalign="left"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd><mtd><mi>c</mi></mtd></mtr></mtable></math>`,
		{ contentType: 'text/xml' },
	).window.document;
	const descriptors = collectMatrixAlignments(source);
	assert.deepEqual(
		descriptors,
		[{ columns: ['left', 'left', 'left'], rowLengths: [3], parent: null }],
		'last MathML alignment repeats across remaining columns',
	);
	const empty = `<m:oMath xmlns:m="${MATH_NS}"/>`;
	assert.throws(
		() => restoreMatrixAlignments(empty, descriptors),
		/matrix count mismatch/,
	);
	const short = `<m:oMath xmlns:m="${MATH_NS}"><m:m><m:mr><m:e/></m:mr></m:m></m:oMath>`;
	assert.throws(
		() => restoreMatrixAlignments(short, descriptors),
		/nesting or dimensions mismatch/,
	);
	assert.throws(
		() =>
			collectMatrixAlignments(
				new JSDOM(
					source.documentElement.outerHTML.replace(
						'columnalign="left"',
						'columnalign="decimalpoint"',
					),
					{ contentType: 'text/xml' },
				).window.document,
			),
		/Unsupported MathML matrix column alignment/,
	);
	const nested = `<m:oMath xmlns:m="${MATH_NS}"><m:m><m:mr><m:e><m:m><m:mr><m:e/></m:mr></m:m></m:e></m:mr></m:m></m:oMath>`;
	assert.throws(
		() =>
			restoreMatrixAlignments(nested, [
				{ columns: ['left'], rowLengths: [1], parent: null },
				{ columns: ['right'], rowLengths: [1], parent: null },
			]),
		/nesting or dimensions mismatch/,
	);
}

async function run(): Promise<void> {
	assert.equal(cases.length, 7, 'all seven named system controls discovered');
	runAlignmentGuards();
	runMatrixSpacingTests();
	await mathJaxReady();
	const document = new Document({
		sections: [
			{
				children: cases.map(
					item =>
						new Paragraph({
							children: [convertLatex2Math(item.latex)],
						}),
				),
			},
		],
	});
	const buffer = await Packer.toBuffer(document);
	const xml = new AdmZip(buffer).readAsText('word/document.xml');
	const formulas = [
		...new JSDOM(xml, {
			contentType: 'text/xml',
		}).window.document.getElementsByTagName('m:oMath'),
	];
	assert.equal(
		formulas.length,
		cases.length,
		'every system survives DOCX serialization',
	);
	for (const [index, control] of cases.entries()) {
		const formula = formulas[index];
		const matrices = [...formula.getElementsByTagName('m:m')];
		assert.equal(matrices.length, control.matrices.length, control.name);
		for (const [matrixIndex, expected] of control.matrices.entries()) {
			const matrix = matrices[matrixIndex];
			if (index === 4 || index === 5) {
				assert.equal(
					matrix
						.getElementsByTagName('m:rSp')[0]
						?.getAttribute('m:val'),
					'416',
					'normal and nested MathJax matrices use the minimum baseline',
				);
				assert.equal(
					matrix
						.getElementsByTagName('m:cGp')[0]
						?.getAttribute('m:val'),
					'280',
					'normal and nested MathJax matrices preserve the 1em column gap',
				);
			}

			assert.deepEqual(
				expandedAlignment(matrix),
				expected.alignment,
				`${control.name}: columns`,
			);
			assert.deepEqual(
				children(matrix, 'm:mr').map(row =>
					children(row, 'm:e').map(cell =>
						(cell.textContent ?? '').replaceAll('\u00a0', ' '),
					),
				),
				expected.cells,
				`${control.name}: every row, cell and condition preserved`,
			);
		}
		if (index === 0 || index === 1 || index === 5) {
			const delimiter = formula.getElementsByTagName('m:d')[0];
			assert.ok(
				delimiter,
				`${control.name}: scalable system delimiter preserved`,
			);
			assert.equal(
				delimiter
					.getElementsByTagName('m:begChr')[0]
					?.getAttribute('m:val'),
				'{',
			);
			assert.equal(
				delimiter
					.getElementsByTagName('m:endChr')[0]
					?.getAttribute('m:val'),
				'',
			);
		}
	}
	assert.equal(
		formulas[0].getElementsByTagName('m:f').length,
		1,
		'tall case fraction remains structural',
	);
	assert.equal(
		formulas[1].getElementsByTagName('m:f').length,
		1,
		'tall aligned fraction remains structural',
	);
	assert.doesNotMatch(
		xml,
		/口|\uE100|\uE101/,
		'no placeholder or fence markers leak',
	);
	console.log(
		'Math systems: 7 generated controls, 9 matrices, exact alignments/rows/cells, tall fractions, braces and 4 fail-closed guard checks passed. Fixtures remained in memory.',
	);
}

run().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
