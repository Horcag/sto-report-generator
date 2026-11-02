import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { getStoStylePresetDisplayNames } from '@/shared/config';

import {
	buildWordcraft0140PaginationFixture,
	buildWordcraft0140UndefinedStyleFixture,
} from './wordcraft_0140_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string): string | null =>
	element.getAttributeNS(WORD, name);

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0140-'),
	);
	try {
		for (const [lines, widow, bodyHeightPt] of [
			[2, true, 240],
			[3, true, 240],
			[4, true, 240],
			[3, false, 240],
			[3, true, 300],
		] as const) {
			const filename = path.join(
				directory,
				`pagination-${lines}-${widow}-${bodyHeightPt}.docx`,
			);
			await buildWordcraft0140PaginationFixture(
				filename,
				7,
				widow,
				lines,
				bodyHeightPt,
			);
			const archive = new AdmZip(filename);
			const dom = new JSDOM(archive.readAsText('word/document.xml'), {
				contentType: 'text/xml',
			});
			try {
				const document = dom.window.document;
				const paragraphs = nodes(document, 'p');
				assert.equal(
					paragraphs.length,
					9,
					'seven filler paragraphs, one heading and one multiline paragraph',
				);
				assert.deepEqual(
					paragraphs
						.slice(0, 7)
						.map(paragraph => paragraph.textContent),
					Array.from(
						{ length: 7 },
						(_, index) => `FILLER-${index + 1}`,
					),
				);
				for (const paragraph of paragraphs) {
					const spacing = nodes(paragraph, 'spacing')[0];
					assert.equal(value(spacing, 'before'), '0');
					assert.equal(value(spacing, 'after'), '0');
					assert.equal(value(spacing, 'line'), '320');
					assert.equal(value(spacing, 'lineRule'), 'exact');
					assert.equal(
						value(nodes(paragraph, 'ind')[0], 'firstLine'),
						'0',
					);
					for (const run of nodes(paragraph, 'r')) {
						assert.equal(
							value(nodes(run, 'rFonts')[0], 'ascii'),
							'Times New Roman',
						);
						assert.equal(value(nodes(run, 'sz')[0], 'val'), '28');
					}
				}
				const heading = paragraphs[7];
				assert.equal(heading.textContent, 'HEADING-KEEP');
				assert.equal(nodes(heading, 'keepNext').length, 1);
				assert.equal(nodes(heading, 'keepLines').length, 1);
				for (const flag of ['keepNext', 'keepLines'])
					assert.notEqual(
						value(nodes(heading, flag)[0], 'val'),
						'false',
					);
				const body = paragraphs[8];
				assert.deepEqual(
					nodes(body, 't').map(node => node.textContent),
					['Bb', 'Bc', 'Bd', 'Be'].slice(0, lines),
				);
				assert.equal(
					nodes(body, 'br').length,
					lines - 1,
					'explicit lines stay inside one paragraph',
				);
				assert.equal(
					value(nodes(body, 'widowControl')[0], 'val') === 'false',
					!widow,
				);
				for (const flag of ['keepNext', 'keepLines'])
					assert.equal(value(nodes(body, flag)[0], 'val'), 'false');
				const margins = nodes(document, 'pgMar')[0];
				for (const side of ['header', 'footer'])
					assert.equal(value(margins, side), '0');
				assert.equal(
					Number(value(nodes(document, 'pgSz')[0], 'h')) -
						Number(value(margins, 'top')) -
						Number(value(margins, 'bottom')),
					bodyHeightPt * 20,
				);
				assert.equal(nodes(document, 'headerReference').length, 0);
				assert.equal(nodes(document, 'footerReference').length, 0);
				console.log(
					`PASS 0140 pagination inputs: ${lines} lines, widow=${widow}, body=${bodyHeightPt}pt, seven fillers`,
				);
			} finally {
				dom.window.close();
			}
		}
		const filename = path.join(directory, 'undefined-style.docx');
		await buildWordcraft0140UndefinedStyleFixture(filename);
		const archive = new AdmZip(filename);
		const stylesDom = new JSDOM(archive.readAsText('word/styles.xml'), {
			contentType: 'text/xml',
		});
		try {
			const stylesDocument = stylesDom.window.document;
			const styles = nodes(stylesDocument, 'style');
			const style = (id: string): Element => {
				const found = styles.find(
					element => value(element, 'styleId') === id,
				);
				assert.ok(found, `required style exists: ${id}`);
				return found;
			};
			assert.equal(
				styles.some(element => value(element, 'styleId') === 'Footer'),
				false,
				'Footer is genuinely undefined',
			);
			for (const id of Object.keys(
				getStoStylePresetDisplayNames('default'),
			))
				style(id);
			const defaults = nodes(stylesDocument, 'docDefaults')[0];
			assert.equal(value(nodes(defaults, 'sz')[0], 'val'), '24');
			assert.equal(value(nodes(defaults, 'spacing')[0], 'after'), '200');
			const normal = style('Normal');
			assert.equal(value(nodes(normal, 'sz')[0], 'val'), '26');
			const spacing = nodes(normal, 'spacing')[0];
			for (const [name, expected] of [
				['before', '20'],
				['after', '40'],
				['line', '259'],
				['lineRule', 'auto'],
			])
				assert.equal(value(spacing, name), expected);
			assert.equal(
				value(nodes(style('DefinedFooter9'), 'sz')[0], 'val'),
				'18',
			);
			const stories = [
				'word/document.xml',
				...archive
					.getEntries()
					.map(entry => entry.entryName)
					.filter(name => /^word\/footer\d+\.xml$/.test(name)),
			];
			assert.equal(
				stories.length,
				4,
				'body and three distinct footer stories discovered',
			);
			const markers: string[] = [];
			for (const story of stories) {
				const dom = new JSDOM(archive.readAsText(story), {
					contentType: 'text/xml',
				});
				try {
					for (const paragraph of nodes(
						dom.window.document,
						'p',
					).filter(paragraph => nodes(paragraph, 't').length > 0)) {
						const marker = paragraph.textContent ?? '';
						markers.push(marker);
						const defined = marker.startsWith('DEFINED-');
						const direct = marker.startsWith('DIRECT-');
						assert.equal(
							value(nodes(paragraph, 'pStyle')[0], 'val'),
							defined ? 'DefinedFooter9' : 'Footer',
						);
						assert.deepEqual(
							nodes(paragraph, 'sz').map(node =>
								value(node, 'val'),
							),
							direct ? ['32'] : [],
							'only direct control sets run size',
						);
					}
				} finally {
					dom.window.close();
				}
			}
			assert.deepEqual(
				markers.sort(),
				['UNDEFINED-FOOTER', 'DEFINED-FOOTER9', 'DIRECT-FOOTER16']
					.flatMap(marker => [`${marker}-BODY`, `${marker}-STORY`])
					.sort(),
			);
			console.log(
				'PASS 0140 undefined style inputs: missing Footer, document defaults12pt/10pt after, distinct Normal13pt, defined9pt and direct16pt body/footer controls',
			);
		} finally {
			stylesDom.window.close();
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
