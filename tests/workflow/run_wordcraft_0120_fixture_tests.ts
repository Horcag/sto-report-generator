import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { MARGINS } from '@/shared/config';

import { buildWordcraft0120Fixture } from './wordcraft_0120_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string): string | null =>
	element.getAttributeNS(WORD, name);

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0120-'),
	);
	try {
		for (const expand of [true, false]) {
			const filename = path.join(directory, `expand-${expand}.docx`);
			if (expand) await buildWordcraft0120Fixture(filename);
			else await buildWordcraft0120Fixture(filename, false);
			const archive = new AdmZip(filename);
			const dom = new JSDOM(archive.readAsText('word/document.xml'), {
				contentType: 'text/xml',
			});
			const settings = new JSDOM(
				archive.readAsText('word/settings.xml'),
				{ contentType: 'text/xml' },
			);
			try {
				const document = dom.window.document;
				const paragraphs = nodes(document, 'p');
				const control = (marker: string): Element => {
					const index = paragraphs.findIndex(
						paragraph => paragraph.textContent === marker,
					);
					assert.ok(
						index >= 0,
						`control marker discovered: ${marker}`,
					);
					assert.ok(paragraphs[index + 1]);
					return paragraphs[index + 1];
				};
				for (const [marker, whitespace] of [
					['NBSP-10-START', '\u00a0'],
					['SPACE-10-START', ' '],
				]) {
					const paragraph = control(marker);
					assert.equal(nodes(paragraph, 'r').length, 1);
					assert.equal(
						paragraph.textContent,
						`A${whitespace.repeat(10)}B`,
					);
					assert.equal(
						value(nodes(paragraph, 'rFonts')[0], 'ascii'),
						'Times New Roman',
					);
					assert.equal(value(nodes(paragraph, 'sz')[0], 'val'), '28');
					assert.equal(
						nodes(paragraph, 't')[0].getAttribute('xml:space'),
						'preserve',
					);
				}
				for (const offset of [undefined, 0, 2, 3]) {
					const paragraph = control(
						offset === undefined
							? 'BOOKMARK-PLAIN-START'
							: `BOOKMARK-OFFSET-${offset}-START`,
					);
					assert.equal(paragraph.textContent, 'Oremus');
					assert.equal(
						11906 -
							MARGINS.left -
							MARGINS.right -
							Number(value(nodes(paragraph, 'ind')[0], 'right')),
						600,
					);
					const starts = nodes(paragraph, 'bookmarkStart');
					const ends = nodes(paragraph, 'bookmarkEnd');
					assert.equal(
						starts.length,
						offset === undefined ? 0 : offset === 0 ? 2 : 1,
					);
					assert.equal(ends.length, starts.length);
					if (offset !== undefined)
						for (const [index, start] of starts.entries()) {
							assert.equal(
								value(start, 'id'),
								String(offset + index * 10),
							);
							assert.equal(
								value(ends[index], 'id'),
								value(start, 'id'),
							);
							assert.equal(
								value(start, 'name'),
								`WORDCRAFT0120_OFFSET_${offset}${index ? '_SECOND' : ''}`,
							);
							assert.equal(
								start.nextElementSibling,
								ends[index],
								'bookmark has zero width',
							);
							const before = [...paragraph.children]
								.slice(
									0,
									[...paragraph.children].indexOf(start),
								)
								.map(child => child.textContent)
								.join('');
							assert.equal(before, 'Oremus'.slice(0, offset));
						}
				}
				const shifted = control('SHIFT-RETURN-START');
				assert.equal(value(nodes(shifted, 'jc')[0], 'val'), 'both');
				assert.deepEqual(
					nodes(shifted, 't').map(node => node.textContent),
					['We tie the spend', 'to a pipe'],
				);
				assert.equal(nodes(shifted, 'br').length, 1);
				assert.equal(
					nodes(shifted, 'br')[0].hasAttributeNS(WORD, 'type'),
					false,
				);
				assert.deepEqual(
					[...nodes(shifted, 'r')[0].children].map(
						child => child.localName,
					),
					['rPr', 't', 'br', 't'],
				);
				const flags = nodes(
					settings.window.document,
					'doNotExpandShiftReturn',
				);
				assert.equal(
					nodes(settings.window.document, 'compat').length,
					1,
				);
				assert.equal(flags.length, 1);
				assert.equal(flags[0].parentElement?.localName, 'compat');
				assert.equal(value(flags[0], 'val'), expand ? '0' : '1');
				assert.equal(value(nodes(document, 'pgSz')[0], 'w'), '11906');
				assert.equal(value(nodes(document, 'pgSz')[0], 'h'), '16838');
				for (const [side, margin] of Object.entries(MARGINS))
					assert.equal(
						value(nodes(document, 'pgMar')[0], side),
						String(margin),
					);
				assert.ok(
					archive
						.readAsText('docProps/core.xml')
						.includes('Public renderer regression fixture'),
				);
				assert.ok(
					paragraphs.some(
						paragraph =>
							paragraph.textContent === 'WORDCRAFT-0120-END',
					),
				);
				console.log(
					`PASS Wordcraft 0.12.0 fixture expand=${expand}: NBSP/SPACE x10, 30pt bookmarks, manual break, explicit compatibility and STO geometry`,
				);
			} finally {
				dom.window.close();
				settings.window.close();
			}
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
