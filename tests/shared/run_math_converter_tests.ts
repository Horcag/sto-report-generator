import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';
import { JSDOM } from 'jsdom';

import {
	convertLatex2Math,
	FormulaConversionError,
	mathJaxReady,
	normalizeMathJaxImportSpecifier,
} from '../../src/shared/lib/math-converter';
import { validateSourceFormulas } from '../../src/shared/lib/source-preflight/formula-checker';

assert.equal(
	normalizeMathJaxImportSpecifier(
		'D:\\a\\sto report generator\\node_modules\\mathjax\\input\\tex.js',
	),
	'file:///D:/a/sto%20report%20generator/node_modules/mathjax/input/tex.js',
);

const absolutePosixPath = '/tmp/mathjax/input/tex.js';
assert.equal(
	normalizeMathJaxImportSpecifier(absolutePosixPath),
	pathToFileURL(absolutePosixPath).href,
);
assert.equal(
	normalizeMathJaxImportSpecifier('@mathjax/src/bundle/input/tex.js'),
	'@mathjax/src/bundle/input/tex.js',
);

async function main(): Promise<void> {
	await mathJaxReady();
	assert.doesNotThrow(() => convertLatex2Math('\\frac{1}{x^2 - 1}'));
	const semanticMath = [
		'\\stovec{a}',
		'\\stomat{A}',
		'20\\,\\stotemp{K}',
		'\\stoelem{Fe}',
		'x_{\\stoabbr{max}}',
	].map(convertLatex2Math);
	const accentMath = [
		'\\bar{R}_x',
		'\\overline{AB}',
		'\\tilde{y}',
		'\\hat{x}',
		'\\widehat{XY}',
		'\\sum_{i=1}^{n}x_i',
	].map(convertLatex2Math);
	const docx = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [...semanticMath, ...accentMath].map(
						math => new Paragraph({ children: [math] }),
					),
				},
			],
		}),
	);
	const xml = new AdmZip(docx)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(xml);
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window
		.document;
	assert.equal(document.getElementsByTagName('undefined').length, 0);
	const math = [...document.getElementsByTagName('m:oMath')];
	assert.equal(math.length, 11);
	const runs = (element: Element) => [...element.getElementsByTagName('m:r')];
	const text = (element: Element) =>
		element.getElementsByTagName('m:t')[0]?.textContent;
	for (const [index, symbol] of [
		[0, 'a'],
		[1, 'A'],
	] as const) {
		const run = runs(math[index]).find(value => text(value) === symbol);
		assert.ok(run);
		assert.equal(
			run.getElementsByTagName('m:sty')[0]?.getAttribute('m:val'),
			'b',
		);
		assert.equal(run.getElementsByTagName('m:nor').length, 1);
		assert.equal(run.getElementsByTagName('m:rPr')[0]?.parentElement, run);
	}
	for (const [index, symbol] of [
		[2, 'K'],
		[3, 'Fe'],
	] as const) {
		const run = runs(math[index]).find(value => text(value) === symbol);
		assert.ok(run);
		assert.equal(run.getElementsByTagName('m:nor').length, 1);
		assert.equal(run.getElementsByTagName('m:rPr')[0]?.parentElement, run);
		assert.equal(run.getElementsByTagName('w:b').length, 0);
	}
	const subscript = math[4].getElementsByTagName('m:sSub')[0];
	assert.ok(subscript);
	const abbreviatedRun = runs(
		subscript.getElementsByTagName('m:sub')[0],
	).find(value => text(value) === 'max');
	assert.ok(abbreviatedRun);
	assert.equal(abbreviatedRun.getElementsByTagName('m:nor').length, 1);
	for (const formula of math.slice(5, 7)) {
		assert.equal(formula.getElementsByTagName('m:bar').length, 1);
		assert.equal(formula.getElementsByTagName('m:limUpp').length, 0);
	}
	const singleBar = convertLatex2Math('\\bar{y}');
	const singleBarDocx = await Packer.toBuffer(
		new Document({
			sections: [
				{ children: [new Paragraph({ children: [singleBar] })] },
			],
		}),
	);
	const singleBarXml = new AdmZip(singleBarDocx)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(singleBarXml);
	const singleBarElement = new JSDOM(singleBarXml, {
		contentType: 'text/xml',
	}).window.document.getElementsByTagName('m:bar')[0];
	assert.ok(singleBarElement);
	assert.equal(singleBarElement.getElementsByTagName('m:sSup').length, 0);
	assert.equal(singleBarElement.getElementsByTagName('m:sSub').length, 0);
	assert.equal(
		singleBarElement.getElementsByTagName('m:e')[0]?.textContent,
		'y',
	);
	for (const [formula, mark] of [
		[math[7], '\u0303'],
		[math[8], '\u0302'],
	] as const) {
		assert.equal(
			formula
				.getElementsByTagName('m:acc')[0]
				?.getElementsByTagName('m:chr')[0]
				?.getAttribute('m:val'),
			mark,
		);
	}
	assert.equal(math[9].getElementsByTagName('m:groupChr').length, 1);
	assert.equal(math[10].getElementsByTagName('m:limUpp').length, 1);
	assert.equal(
		math[10].getElementsByTagName('m:limLow')[0]?.textContent,
		'∑i=1',
	);
	assert.equal(
		math[10].getElementsByTagName('m:limUpp')[0]?.textContent,
		'∑i=1n',
	);
	assert.equal(xml.includes('口'), false);
	const issues: Parameters<typeof validateSourceFormulas>[2] = [];
	validateSourceFormulas('formula.md', '$x_{\\stoabbr{max}}$', issues);
	assert.equal(
		issues.some(issue => issue.code === 'formula-bare-upright-function'),
		false,
	);
	const abbreviationIssues: Parameters<typeof validateSourceFormulas>[2] = [];
	validateSourceFormulas(
		'formula.md',
		'$MAE + RMSE + y_i^{pred} + \\stoabbr{BA} + R_{xi} + \\min_i x_i$',
		abbreviationIssues,
	);
	assert.equal(
		abbreviationIssues.filter(
			issue => issue.code === 'formula-bare-upright-abbreviation',
		).length,
		1,
	);
	assert.match(abbreviationIssues[0]?.message ?? '', /MAE/);
	const uprightMetric = convertLatex2Math(
		'\\stoabbr{MAE}=x_i^{\\stoabbr{pred}}',
	);
	const uprightMinimum = convertLatex2Math('\\min_{k\\geq i}x_k');
	const uprightMedian = convertLatex2Math('\\operatorname{median}(x)');
	const metricDocx = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: [
						new Paragraph({ children: [uprightMetric] }),
						new Paragraph({ children: [uprightMinimum] }),
						new Paragraph({ children: [uprightMedian] }),
					],
				},
			],
		}),
	);
	const metricXml = new AdmZip(metricDocx)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(metricXml);
	assert.doesNotMatch(metricXml, /<undefined\b/);
	const metricMath = new JSDOM(metricXml, {
		contentType: 'text/xml',
	}).window.document.getElementsByTagName('m:oMath')[0];
	for (const name of ['MAE', 'pred']) {
		const run = runs(metricMath).find(value => text(value) === name);
		assert.ok(run);
		assert.equal(run.getElementsByTagName('m:nor').length, 1);
	}
	const minimumMath = new JSDOM(metricXml, {
		contentType: 'text/xml',
	}).window.document.getElementsByTagName('m:oMath')[1];
	const minimumRun = runs(minimumMath).find(value => text(value) === 'min');
	assert.ok(minimumRun);
	assert.equal(minimumRun.getElementsByTagName('m:nor').length, 1);
	assert.equal(minimumRun.getElementsByTagName('m:rPr').length, 1);
	assert.equal(minimumRun.children[0]?.tagName, 'm:rPr');
	const medianMath = new JSDOM(metricXml, {
		contentType: 'text/xml',
	}).window.document.getElementsByTagName('m:oMath')[2];
	const medianRun = runs(medianMath).find(value => text(value) === 'median');
	assert.ok(medianRun);
	assert.equal(medianRun.getElementsByTagName('m:nor').length, 1);
	const medianArgument = runs(medianMath).find(value =>
		text(value)?.includes('x'),
	);
	assert.ok(medianArgument);
	assert.equal(medianArgument.getElementsByTagName('m:nor').length, 0);
	const spacingCases = [
		[String.raw`a,\quad b`, '\u2003'],
		[String.raw`a,\qquad b`, '\u2003\u2003'],
		[String.raw`a\;b`, ' '],
		[
			String.raw`\bar{y}=\frac{1}{n}\sum_{i=1}^{n}y_i,\quad\tilde{y}=\operatorname{median}(y_1,\ldots,y_n)`,
			'\u2003',
		],
	] as const;
	const spacingDocx = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: spacingCases.map(
						([latex]) =>
							new Paragraph({
								children: [convertLatex2Math(latex)],
							}),
					),
				},
			],
		}),
	);
	const spacingXml = new AdmZip(spacingDocx)
		.getEntry('word/document.xml')
		?.getData()
		.toString('utf8');
	assert.ok(spacingXml);
	const spacingMath = [
		...new JSDOM(spacingXml, {
			contentType: 'text/xml',
		}).window.document.getElementsByTagName('m:oMath'),
	];
	const compositeBar = spacingMath[3].getElementsByTagName('m:bar')[0];
	assert.ok(compositeBar);
	assert.equal(compositeBar.getElementsByTagName('m:sSup').length, 0);
	assert.equal(compositeBar.getElementsByTagName('m:sSub').length, 0);
	assert.equal(compositeBar.getElementsByTagName('m:e')[0]?.textContent, 'y');
	for (const [index, [, expectedSpace]] of spacingCases.entries()) {
		assert.ok(spacingMath[index].textContent?.includes(expectedSpace));
	}
	assert.doesNotMatch(spacingXml, /[\uE000\uE001]/);
	for (const invalid of ['x=\\frac{1}{', '\\left( x', '\\badcommand{x}']) {
		assert.throws(
			() => convertLatex2Math(invalid),
			error =>
				error instanceof FormulaConversionError &&
				error.latex === invalid,
		);
	}

	console.log('Math converter tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
