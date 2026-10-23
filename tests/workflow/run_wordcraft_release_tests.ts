import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { STO_STYLE_PRESET_NAMES } from '@/shared/config';

import { buildWordcraftReleaseFixture } from './wordcraft_release_fixture';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-release-test-'),
	);
	try {
		for (const preset of STO_STYLE_PRESET_NAMES) {
			const output = path.join(directory, `${preset}.docx`);
			await buildWordcraftReleaseFixture(output, preset);
			const xml = new AdmZip(output).readAsText('word/document.xml');
			const document = new JSDOM(xml, { contentType: 'text/xml' }).window
				.document;
			assert.equal(
				document.getElementsByTagName('undefined').length,
				0,
				'imported OMML must not serialize its synthetic wrapper',
			);
			const equations = [
				...document.getElementsByTagNameNS(math, 'oMathPara'),
			];
			assert.equal(
				equations.length,
				2,
				'both equation array controls discovered',
			);
			for (const equation of equations) {
				assert.equal(equation.parentElement?.localName, 'p');
				assert.equal(
					equation.parentElement?.namespaceURI,
					word,
					'display math is a direct child of the Word paragraph',
				);
				assert.equal(
					equation.getElementsByTagNameNS(math, 'eqArr').length,
					1,
				);
				assert.equal(
					equation.getElementsByTagNameNS(math, 'e').length,
					2,
				);
			}
			assert.equal(
				equations[0].getElementsByTagNameNS(math, 'aln').length,
				0,
			);
			assert.equal(
				equations[1].getElementsByTagNameNS(math, 'aln').length,
				2,
			);
			assert.equal(
				document.getElementsByTagNameNS(word, 'pageBreakBefore').length,
				3,
			);
			const scripts = [
				...document.getElementsByTagNameNS(word, 'vertAlign'),
			].map(node => node.getAttributeNS(word, 'val'));
			assert.ok(scripts.includes('superscript'));
			assert.ok(scripts.includes('subscript'));
			assert.equal(
				[...document.getElementsByTagNameNS(word, 'tab')].filter(
					node => node.getAttributeNS(word, 'leader') === 'dot',
				).length,
				2,
			);
			assert.ok(
				document.documentElement.textContent?.includes('JUSTIFY-2'),
			);
			assert.ok(
				document.documentElement.textContent?.includes(
					'RELEASE-CONTROLS-END',
				),
			);
			console.log(
				`PASS release fixture ${preset}: valid direct OMML, two alignment controls, scripts, dot leaders and page breaks`,
			);
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
		assert.equal(fs.existsSync(directory), false);
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
