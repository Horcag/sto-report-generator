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
	const docx = await Packer.toBuffer(
		new Document({
			sections: [
				{
					children: semanticMath.map(
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
	const math = [...document.getElementsByTagName('m:oMath')];
	assert.equal(math.length, 5);
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
	}
	for (const [index, symbol] of [
		[2, 'K'],
		[3, 'Fe'],
	] as const) {
		const run = runs(math[index]).find(value => text(value) === symbol);
		assert.ok(run);
		assert.equal(run.getElementsByTagName('m:nor').length, 1);
		assert.equal(run.getElementsByTagName('w:b').length, 0);
	}
	const subscript = math[4].getElementsByTagName('m:sSub')[0];
	assert.ok(subscript);
	const abbreviatedRun = runs(
		subscript.getElementsByTagName('m:sub')[0],
	).find(value => text(value) === 'max');
	assert.ok(abbreviatedRun);
	assert.equal(abbreviatedRun.getElementsByTagName('m:nor').length, 1);
	const issues: Parameters<typeof validateSourceFormulas>[2] = [];
	validateSourceFormulas('formula.md', '$x_{\\stoabbr{max}}$', issues);
	assert.equal(
		issues.some(issue => issue.code === 'formula-bare-upright-function'),
		false,
	);
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
