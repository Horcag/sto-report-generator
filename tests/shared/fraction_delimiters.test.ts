import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import { convertLatex2Math } from '../../src/shared/lib/math';
import { normalizeFractionDelimiters } from '../../src/shared/lib/math/fraction-delimiters';
import { normalizeOmmlMath } from '../../src/shared/lib/math/omml-normalizer';

const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const parse = (content: string): Element =>
	new JSDOM(`<m:oMath xmlns:m="${namespace}">${content}</m:oMath>`, {
		contentType: 'text/xml',
	}).window.document.documentElement;
const fraction =
	'<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>';
const fence = (content: string, grow = '1', begin = '(', end = ')') =>
	`<m:d><m:dPr><m:begChr m:val="${begin}"/><m:endChr m:val="${end}"/><m:grow m:val="${grow}"/></m:dPr><m:e>${content}</m:e></m:d>`;

function assertClearance(root: Element, expected: number): void {
	const before = root.cloneNode(true) as Element;
	assert.equal(normalizeFractionDelimiters(root), expected);
	const first = root.outerHTML;
	assert.equal(normalizeFractionDelimiters(root), 0);
	assert.equal(root.outerHTML, first);
	const restored = root.cloneNode(true) as Element;
	for (const phantom of [...restored.getElementsByTagName('m:phant')])
		phantom.remove();
	assert.ok(
		restored.isEqualNode(before),
		'Original operand XML is unchanged',
	);
	assert.equal(restored.textContent, before.textContent);
	for (const phantom of [...root.getElementsByTagName('m:phant')]) {
		assert.equal(
			phantom.getElementsByTagName('m:show')[0]?.getAttribute('m:val'),
			'0',
		);
		assert.equal(
			phantom.getElementsByTagName('m:zeroWid')[0]?.getAttribute('m:val'),
			'1',
		);
		const box = phantom.getElementsByTagName('m:box')[0];
		assert.ok(box);
		const base = box.firstElementChild!;
		assert.equal(base.tagName, 'm:e');
		assert.equal(base.firstElementChild?.tagName, 'm:argPr');
		assert.equal(
			base.getElementsByTagName('m:argSz')[0]?.getAttribute('m:val'),
			'1',
		);
		const pristine = phantom.parentElement!.cloneNode(true) as Element;
		pristine.lastElementChild!.remove();
		const clone = base.cloneNode(true) as Element;
		clone.firstElementChild!.remove();
		assert.equal(
			clone.innerHTML,
			pristine.innerHTML,
			'Phantom contains pristine operand clone',
		);
	}
}

for (const grow of ['1', 'true', 'on']) {
	for (const [begin, end] of [
		['(', ')'],
		['[', ']'],
		['', ')'],
		['(', ''],
	])
		assertClearance(parse(fence(fraction, grow, begin, end)), 1);
}
assertClearance(
	parse(
		`<m:sSup><m:e>${fence(fraction, '1', '[', ']')}</m:e><m:sup><m:r><m:t>3/2</m:t></m:r></m:sup></m:sSup>`,
	),
	1,
);

const matrix = `<m:m><m:mr><m:e>${fraction}</m:e></m:mr></m:m>`;
for (const content of [
	fraction,
	fence('<m:r><m:t>x</m:t></m:r>'),
	...['0', 'false', 'off', ''].map(grow => fence(fraction, grow)),
	fence(fraction, '1', '', ''),
	fence(matrix),
	fence('<m:argPr><m:argSz m:val="-1"/></m:argPr>' + fraction),
	fence(matrix.repeat(30) + fraction),
	fence(fraction).replace('</m:d>', '<m:e/></m:d>'),
	fence(fraction).replace('<m:grow m:val="1"/>', ''),
	fence(
		fraction + '<m:phant><m:e><m:r><m:t>keep</m:t></m:r></m:e></m:phant>',
	),
]) {
	const root = parse(content);
	const before = root.outerHTML;
	assert.equal(normalizeFractionDelimiters(root), 0);
	assert.equal(root.outerHTML, before);
}
let nested = fraction;
for (let index = 0; index < 40; index++) nested = fence(nested);
const nestedRoot = parse(nested);
assertClearance(nestedRoot, 1);
assert.equal(nestedRoot.getElementsByTagName('m:phant').length, 1);

const overBudget = parse(
	fence(fraction + '<m:r><m:t>x</m:t></m:r>'.repeat(5000)),
);
const beforeBudget = overBudget.outerHTML;
assert.throws(
	() => normalizeFractionDelimiters(overBudget),
	/exceeds 10000 cloned XML elements/,
);
assert.equal(
	overBudget.outerHTML,
	beforeBudget,
	'Budget failure leaves enclosure untouched',
);
const cumulative = parse(
	fence(fraction.repeat(800)) + fence(fraction.repeat(800)),
);
const untouched = cumulative.firstElementChild!.outerHTML;
assert.throws(() => normalizeFractionDelimiters(cumulative), /exceeds 10000/);
assert.equal(cumulative.firstElementChild!.outerHTML, untouched);
assert.equal(cumulative.getElementsByTagName('m:phant').length, 1);

const hooked = parse(fence(fraction));
normalizeOmmlMath(hooked);
assert.equal(hooked.getElementsByTagName('m:phant').length, 1);
console.log(
	'Fraction delimiter normalization: guards, XML preservation, nesting, idempotence and budget passed.',
);

export async function testFractionDelimiterConversion(): Promise<void> {
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [
						String.raw`\left(\frac{a}{b}\right)`,
						String.raw`\left.\frac{a}{b}\right]`,
						String.raw`\left[\frac{1}{n}\sum_{i=1}^{n}x_i^2\right]^{3/2}`,
					].map(
						latex =>
							new Paragraph({
								children: [convertLatex2Math(latex)],
							}),
					),
				},
			],
		}),
	);
	const root = new JSDOM(new AdmZip(buffer).readAsText('word/document.xml'), {
		contentType: 'text/xml',
	}).window.document;
	assert.equal(root.getElementsByTagName('m:phant').length, 3);
	assert.equal(root.getElementsByTagName('m:argSz').length, 3);
	assert.equal(root.getElementsByTagName('undefined').length, 0);
}
