import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import {
	convertLatex2Math,
	mathJaxReady,
	normalizeMathJaxImportSpecifier,
} from '../../src/shared/lib/math-converter';

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

	console.log('Math converter tests passed.');
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
