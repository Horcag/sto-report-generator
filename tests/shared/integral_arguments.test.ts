import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import { convertLatex2Math, convertOmml2Math } from '../../src/shared/lib/math';
import { normalizeOmmlMath } from '../../src/shared/lib/math/omml-normalizer';

const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const parse = (content: string): Element =>
	new JSDOM(`<m:oMath xmlns:m="${namespace}">${content}</m:oMath>`, {
		contentType: 'text/xml',
	}).window.document.documentElement;
const cases: { name: string; source: string; expected: string }[] = JSON.parse(
	readFileSync(
		join(__dirname, '../fixtures/formulas/integral-arguments.json'),
		'utf8',
	),
);
for (const { name, source, expected } of cases) {
	const math = parse(source);
	normalizeOmmlMath(math);
	assert.ok(math.isEqualNode(parse(expected)), name);
	const firstPass = math.outerHTML;
	normalizeOmmlMath(math);
	assert.equal(math.outerHTML, firstPass, `${name}: idempotence`);
}
console.log(
	`N-ary argument normalization: ${cases.length} shared cases and idempotence passed.`,
);

export async function testIntegralConversion(): Promise<void> {
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [
						new Paragraph({
							children: [
								convertLatex2Math(
									String.raw`\operatorname{Integral}=\int_0^1 x^2\,\mathrm{d}x.`,
								),
							],
						}),
					],
				},
			],
		}),
	);
	const xml = new AdmZip(buffer).readAsText('word/document.xml');
	const math = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
	const integral = math.getElementsByTagName('m:nary')[0];
	assert.ok(integral);
	const argument = [...integral.children].find(
		child => child.tagName === 'm:e',
	);
	assert.ok(argument);
	assert.deepEqual(
		[...argument.children].map(child => child.tagName),
		['m:sSup'],
	);
	assert.equal(argument.textContent, 'x2');
	const following: string[] = [];
	for (
		let sibling = integral.nextElementSibling;
		sibling;
		sibling = sibling.nextElementSibling
	) {
		following.push(sibling.textContent ?? '');
	}
	assert.equal(following.join('').trim(), 'dx.');
}

export async function testSumProductConversion(): Promise<void> {
	const meanSource = String.raw`\bar{t}=\frac{1}{M}\sum_{m=1}^{M}t^{(m)},\quad M=20,`;
	const raw = (name: string) =>
		convertOmml2Math(
			`<m:oMath xmlns:m="${namespace}">${cases.find(test => test.name === name)!.source}</m:oMath>`,
		);
	const converted = [
		{
			source: meanSource,
			math: convertLatex2Math(meanSource),
			operator: '∑',
			operand: 't(m)',
			kind: 'm:sSup',
			tail: ',\u2003M=20,',
		},
		{
			source: 'bounded sum with subscript operand',
			math: raw('bounded sum with subscript operand'),
			operator: '∑',
			operand: 'vj',
			kind: 'm:sSub',
			tail: '=6i+21',
		},
		{
			source: 'bounded product with superscript operand',
			math: raw('bounded product with superscript operand'),
			operator: '∏',
			operand: 't(m)',
			kind: 'm:sSup',
			tail: '+1',
		},
	];
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: converted.map(
						test => new Paragraph({ children: [test.math] }),
					),
				},
			],
		}),
	);
	const dom = new JSDOM(new AdmZip(buffer).readAsText('word/document.xml'), {
		contentType: 'text/xml',
	});
	try {
		const equations = [
			...dom.window.document.getElementsByTagName('m:oMath'),
		];
		assert.equal(equations.length, converted.length);
		for (const [index, test] of converted.entries()) {
			const operator = equations[index].getElementsByTagName('m:nary')[0];
			assert.ok(operator, test.source + equations[index].outerHTML);
			assert.equal(
				operator.getElementsByTagName('m:chr')[0].getAttribute('m:val'),
				test.operator,
			);
			const argument = [...operator.children].find(
				child => child.tagName === 'm:e',
			)!;
			assert.ok(argument);
			assert.deepEqual(
				[...argument.children].map(child => child.tagName),
				[test.kind],
			);
			assert.equal(argument.textContent, test.operand);
			let tail = '';
			for (
				let next = operator.nextElementSibling;
				next;
				next = next.nextElementSibling
			)
				tail += next.textContent;
			assert.equal(
				tail,
				test.tail,
				'punctuation and following expression remain outside the operator',
			);
			assert.ok(operator.getElementsByTagName('m:sub')[0].textContent);
			assert.ok(operator.getElementsByTagName('m:sup')[0].textContent);
		}
	} finally {
		dom.window.close();
	}
	console.log(
		'PASS generated sum/product operands, limits, punctuation and mean-time formula regression.',
	);
}
