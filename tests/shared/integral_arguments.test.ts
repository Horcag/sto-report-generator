import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import { convertLatex2Math } from '../../src/shared/lib/math';
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
	`Integral argument normalization: ${cases.length} shared cases and idempotence passed.`,
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
