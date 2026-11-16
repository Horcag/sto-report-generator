import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import { convertLatex2Math, convertOmml2Math } from '../../src/shared/lib/math';
import { normalizeOmmlMath } from '../../src/shared/lib/math/omml-normalizer';
import { inspectMathStructures } from '../../src/shared/lib/sto-validator/math-xml';

const namespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const wrap = (content: string): string =>
	`<m:oMath xmlns:m="${namespace}">${content}</m:oMath>`;
const run = (text: string): string => `<m:r><m:t>${text}</m:t></m:r>`;
const script = (base: string, sup: string): string =>
	`<m:sSup><m:e>${base}</m:e><m:sup>${sup}</m:sup></m:sSup>`;
const nary = (properties = '', sup = ''): string =>
	`<m:nary><m:naryPr><m:chr m:val="∑"/>${properties}</m:naryPr><m:sub/><m:sup>${sup}</m:sup><m:e>${run('x')}</m:e></m:nary>`;

export async function testScriptStructure(): Promise<void> {
	const rawNested = new JSDOM(
		wrap(
			`<m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="―" m:pos="bot"/></m:groupChrPr><m:e>${run('AB')}</m:e></m:groupChr></m:e><m:lim>${run('¯')}</m:lim></m:limUpp>`,
		),
		{ contentType: 'text/xml' },
	).window.document.documentElement;
	normalizeOmmlMath(rawNested);
	assert.deepEqual(
		[...rawNested.getElementsByTagName('m:pos')].map(position =>
			position.getAttribute('m:val'),
		),
		['top', 'bot'],
	);
	assert.equal(rawNested.getElementsByTagName('m:groupChr').length, 0);
	assert.equal(rawNested.textContent, 'AB');
	const brokenPrime = script(run('I'), script(run(''), run('′')));
	assert.equal(
		inspectMathStructures(wrap(script(run('I'), script('', run("'")))))
			.detachedPrimes,
		1,
	);
	assert.equal(inspectMathStructures(wrap(brokenPrime)).detachedPrimes, 1);
	assert.equal(inspectMathStructures(wrap(nary())).unhiddenNaryLimits, 2);
	assert.equal(
		inspectMathStructures(wrap(nary('<m:subHide/><m:supHide m:val="0"/>')))
			.unhiddenNaryLimits,
		1,
	);
	const preserved = [
		script(run(''), run('′')), // a standalone prescript
		script(run('I'), script(run('a'), run('′'))),
		script(run('I'), script(run(''), run('2'))),
		nary('<m:subHide/><m:supHide/>'),
	];
	for (const source of preserved) {
		const document = new JSDOM(wrap(source), { contentType: 'text/xml' })
			.window.document;
		const before = document.documentElement.outerHTML;
		normalizeOmmlMath(document.documentElement);
		// Hidden-limit attributes may become explicit true, but script shapes stay.
		if (!source.includes('m:nary'))
			assert.equal(document.documentElement.outerHTML, before);
		assert.equal(inspectMathStructures(wrap(source)).detachedPrimes, 0);
	}
	assert.equal(
		inspectMathStructures(
			wrap(
				`<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>${nary()}${brokenPrime}</m:e></m:phant>`,
			),
		).unhiddenNaryLimits,
		0,
	);
	const operators = [
		String.raw`d_{\min}+d_{\max}`,
		String.raw`\max(x,y)`,
		String.raw`\min_i x_i`,
		String.raw`\text{median}_i x_i`,
		'm+a+x',
	];
	const operatorBuffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: operators.map(
						formula =>
							new Paragraph({
								children: [convertLatex2Math(formula)],
							}),
					),
				},
			],
		}),
	);
	const operatorDoc = new JSDOM(
		new AdmZip(operatorBuffer).readAsText('word/document.xml'),
		{ contentType: 'text/xml' },
	).window.document;
	const operatorMaths = [...operatorDoc.getElementsByTagName('m:oMath')];
	for (const formula of operatorMaths.slice(0, -1)) {
		const runs = [...formula.getElementsByTagName('m:r')].filter(run =>
			['min', 'max', 'median'].includes(run.textContent ?? ''),
		);
		assert.ok(runs.length);
		for (const run of runs)
			assert.equal(run.getElementsByTagName('m:nor').length, 1);
	}
	assert.equal(operatorMaths.at(-1)!.getElementsByTagName('m:nor').length, 0);
	const formulas = [
		"I'",
		"I^{'}",
		"I^{''}",
		String.raw`x^{a'}`,
		String.raw`\sum_i^{} x_i`,
		String.raw`\sum_{}^n x_i`,
		String.raw`\sum x`,
		String.raw`\sum_i^n x_i`,
		String.raw`\hat d_i`,
		String.raw`\hat{d_i}`,
		String.raw`\sum_i x_i`,
		String.raw`\prod_i x_i`,
		String.raw`\int_0^1 x^2\,\mathrm{d}x`,
		String.raw`\prod x`,
		String.raw`\text{∑x}`,
		String.raw`\sum\nolimits_i x_i`,
		String.raw`\underline{AB}`,
		String.raw`\overline{AB}`,
		String.raw`\text{∑x}_i`,
		String.raw`\text{∑x}^2`,
		String.raw`\text{∏x}_{i}^{2}`,
		String.raw`\text{∏x}^2`,
		String.raw`{\sum}_{i}x_i`,
		String.raw`{\prod}^{N}x_i`,
		String.raw`\operatorname{∑x}_i`,
		String.raw`\operatorname{∏x}^2`,
		String.raw`\overline{\underline{AB}}`,
		String.raw`\bar{\tilde{x}}`,
	];
	const buffer = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [
						...formulas.map(
							formula =>
								new Paragraph({
									children: [convertLatex2Math(formula)],
								}),
						),
						new Paragraph({
							children: [convertOmml2Math(wrap(nary()))],
						}),
					],
				},
			],
		}),
	);
	const xml = new AdmZip(buffer).readAsText('word/document.xml');
	const findings = inspectMathStructures(xml);
	assert.equal(findings.detachedPrimes, 0);
	assert.equal(findings.unhiddenNaryLimits, 0);
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	const maths = [...document.getElementsByTagName('m:oMath')];
	assert.equal(maths[1].getElementsByTagName('m:sSup').length, 1);
	assert.equal(maths[2].textContent, 'I″');
	assert.equal(maths[3].getElementsByTagName('m:sSup').length, 2);
	assert.equal(maths[4].getElementsByTagName('m:limUpp').length, 0);
	assert.equal(maths[4].getElementsByTagName('m:nary').length, 1);
	assert.equal(maths[5].getElementsByTagName('m:limLow').length, 0);
	assert.equal(maths[7].getElementsByTagName('m:nary').length, 1);
	assert.equal(maths[8].getElementsByTagName('m:acc')[0].textContent, 'd');
	assert.equal(maths[9].getElementsByTagName('m:acc')[0].textContent, 'di');
	assert.equal(
		maths[8].getElementsByTagName('m:chr')[0].getAttribute('m:val'),
		'\u0302',
	);
	assert.ok(
		maths[4].isEqualNode(maths[10]),
		'omitted and explicitly empty upper limits must agree',
	);
	for (const index of [4, 5, 6, 7, 10, 11, 12, 13, 15])
		assert.equal(maths[index].getElementsByTagName('m:nary').length, 1);
	assert.equal(
		maths[11].getElementsByTagName('m:chr')[0].getAttribute('m:val'),
		'∏',
	);
	assert.equal(
		maths[12].getElementsByTagName('m:limLoc')[0].getAttribute('m:val'),
		'subSup',
	);
	assert.equal(maths[12].getElementsByTagName('m:e')[0].textContent, 'x2');
	assert.equal(maths[12].textContent?.endsWith('dx'), true);
	assert.equal(
		maths[14].getElementsByTagName('m:nary').length,
		0,
		'text literals must remain text',
	);
	assert.equal(
		maths[15].getElementsByTagName('m:limLoc')[0].getAttribute('m:val'),
		'subSup',
	);
	for (const index of [4, 6, 11, 13])
		assert.equal(
			maths[index]
				.getElementsByTagName('m:grow')[0]
				.getAttribute('m:val'),
			'1',
		);
	assert.equal(
		maths[16].getElementsByTagName('m:pos')[0].getAttribute('m:val'),
		'bot',
	);
	assert.equal(
		maths[17].getElementsByTagName('m:pos')[0].getAttribute('m:val'),
		'top',
	);
	for (const index of [18, 19, 20, 21, 24, 25]) {
		assert.equal(maths[index].getElementsByTagName('m:nary').length, 0);
		assert.ok(
			maths[index].textContent?.includes(
				[18, 19, 24].includes(index) ? '∑x' : '∏x',
			),
		);
		assert.ok(!maths[index].textContent?.includes('LITERAL'));
	}
	for (const index of [22, 23])
		assert.equal(maths[index].getElementsByTagName('m:nary').length, 1);
	assert.deepEqual(
		[...maths[26].getElementsByTagName('m:pos')].map(position =>
			position.getAttribute('m:val'),
		),
		['top', 'bot'],
	);
	assert.equal(maths[26].getElementsByTagName('m:groupChr').length, 0);
	assert.equal(
		maths[27].getElementsByTagName('m:pos')[0].getAttribute('m:val'),
		'top',
	);
	assert.equal(
		maths[27].getElementsByTagName('m:chr')[0].getAttribute('m:val'),
		'\u0303',
	);
	assert.equal(maths[27].getElementsByTagName('m:limUpp').length, 0);
	console.log(
		'Script structure: 28 TeX conversions, packed OMML, negative and preservation cases passed.',
	);
}
