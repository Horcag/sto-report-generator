import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { STO_RULES } from '@/shared/config/sto-rules';
import {
	collectMatrixAlignments,
	restoreMatrixAlignments,
} from '@/shared/lib/math/matrix-alignment';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const table = (spacing = '', content = '<mi>a</mi>'): string =>
	`<mtable ${spacing}><mtr><mtd>${content}</mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable>`;
const collect = (body: string) =>
	collectMatrixAlignments(
		new JSDOM(`<math xmlns="${MATHML_NS}">${body}</math>`, {
			contentType: 'text/xml',
		}).window.document,
	);

export function runMatrixSpacingTests(): void {
	assert.equal(STO_RULES.typography.fontSizePoints, 14);
	for (const [source, expected] of [
		['1em', 280],
		['4pt', 80],
		['.5em 0.50em', 140],
		['1em 14pt', 280],
		['0pt', 0],
	] as const) {
		assert.equal(
			collect(table(`columnspacing="${source}"`))[0].columnGapTwips,
			expected,
			source,
		);
	}
	for (const source of [
		'',
		'1px',
		'1em 2em',
		'-1em',
		'NaNem',
		'1e2pt',
		'4pt invalid',
	]) {
		assert.equal(
			collect(table(`columnspacing="${source}"`))[0].columnGapTwips,
			undefined,
			source,
		);
	}
	assert.equal(collect(table())[0].columnGapTwips, undefined);

	for (const [source, expected] of [
		['4pt', 416],
		['4pt 4.0pt', 416],
		['.5pt 0.50pt', 346],
		['0pt', 336],
		['4.125pt', 419],
	] as const) {
		assert.equal(
			collect(table(`rowspacing="${source}"`))[0].minRowBaselineTwips,
			expected,
			source,
		);
	}
	for (const source of [
		'',
		'4em',
		'4px',
		'4pt 5pt',
		'-1pt',
		'NaNpt',
		'Infinitypt',
		'4pt invalid',
		'4',
		'1e2pt',
	]) {
		assert.equal(
			collect(table(`rowspacing="${source}"`))[0].minRowBaselineTwips,
			undefined,
			source,
		);
	}
	assert.equal(collect(table())[0].minRowBaselineTwips, undefined);
	for (const wrapper of [
		'mfrac',
		'msqrt',
		'mroot',
		'msub',
		'msup',
		'msubsup',
		'munder',
		'mover',
		'munderover',
		'mmultiscripts',
	]) {
		assert.equal(
			collect(
				`<${wrapper}>${table('rowspacing="4pt" columnspacing="1em"')}<mi>x</mi></${wrapper}>`,
			)[0].minRowBaselineTwips,
			undefined,
			wrapper,
		);
		assert.equal(
			collect(
				`<${wrapper}>${table('columnspacing="1em"')}<mi>x</mi></${wrapper}>`,
			)[0].columnGapTwips,
			undefined,
			wrapper,
		);
	}
	for (const attribute of [
		'scriptlevel="1"',
		'scriptlevel="+1"',
		'mathsize="small"',
	]) {
		assert.equal(
			collect(
				`<mstyle ${attribute}>${table('rowspacing="4pt" columnspacing="1em"')}</mstyle>`,
			)[0].minRowBaselineTwips,
			undefined,
			attribute,
		);
		assert.equal(
			collect(
				`<mstyle ${attribute}>${table('columnspacing="1em"')}</mstyle>`,
			)[0].columnGapTwips,
			undefined,
			attribute,
		);
	}
	const nested = collect(
		table(
			'rowspacing="4pt"',
			table('rowspacing="4pt" columnspacing="1em"'),
		),
	);
	assert.deepEqual(
		nested.map(item => [item.parent, item.minRowBaselineTwips]),
		[
			[null, 416],
			[0, 416],
		],
	);
	const descriptor = collect(table('rowspacing="4pt" columnspacing="1em"'));
	const xml = `<m:oMath xmlns:m="${MATH_NS}"><m:m><m:mPr><m:baseJc m:val="center"/><m:plcHide m:val="0"/><m:rSp m:val="1"/><m:rSpRule m:val="0"/><m:rSp m:val="2"/><m:cGpRule m:val="0"/><m:cSp m:val="0"/><m:cGp m:val="1"/><m:cGp m:val="2"/><m:mcs/><m:ctrlPr/></m:mPr><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr></m:m></m:oMath>`;
	const restored = restoreMatrixAlignments(xml, descriptor);
	assert.equal(
		restoreMatrixAlignments(restored, descriptor),
		restored,
		'idempotent',
	);
	const document = new JSDOM(restored, { contentType: 'text/xml' }).window
		.document;
	assert.deepEqual(
		[...document.getElementsByTagName('m:mPr')[0].children].map(
			child => child.localName,
		),
		[
			'baseJc',
			'plcHide',
			'rSpRule',
			'cGpRule',
			'rSp',
			'cSp',
			'cGp',
			'mcs',
			'ctrlPr',
		],
	);
	assert.equal(
		document.getElementsByTagName('m:rSpRule')[0].getAttribute('m:val'),
		'3',
	);
	assert.equal(
		document.getElementsByTagName('m:rSp')[0].getAttribute('m:val'),
		'416',
	);
	assert.deepEqual(
		[...document.getElementsByTagName('m:mr')].map(row => row.outerHTML),
		[
			...new JSDOM(xml, {
				contentType: 'text/xml',
			}).window.document.getElementsByTagName('m:mr'),
		].map(row => row.outerHTML),
		'visible rows and cells unchanged',
	);
	assert.doesNotMatch(restored, /phant|drawing|pict/);
	assert.equal(
		document.getElementsByTagName('m:cGpRule')[0].getAttribute('m:val'),
		'3',
	);
	assert.equal(
		document.getElementsByTagName('m:cGp')[0].getAttribute('m:val'),
		'280',
	);
	const absent = collect(table());
	assert.match(restoreMatrixAlignments(xml, absent), /m:rSp m:val="1"/);
	assert.match(restoreMatrixAlignments(xml, absent), /m:cGp m:val="1"/);
	console.log(
		'Matrix spacing: point parsing, normal/nested eligibility, size-context exclusions, minimum baseline, property order, idempotence and unchanged visible topology passed.',
	);
}
