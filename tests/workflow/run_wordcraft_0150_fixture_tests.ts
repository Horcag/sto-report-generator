import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	buildWordcraft0150PictureFixture,
	buildWordcraft0150TabFixture,
	buildWordcraft0150TableFixture,
} from './wordcraft_0150_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string): string | null =>
	element.getAttributeNS(WORD, name);

function page(
	document: Document,
	width: number,
	height: number,
	margin: number,
): void {
	assert.equal(nodes(document, 'sectPr').length, 1);
	const size = nodes(document, 'pgSz')[0];
	assert.equal(value(size, 'w'), String(width));
	assert.equal(value(size, 'h'), String(height));
	const margins = nodes(document, 'pgMar')[0];
	for (const side of ['top', 'bottom', 'left', 'right'])
		assert.equal(value(margins, side), String(margin));
	for (const side of ['header', 'footer', 'gutter'])
		assert.equal(value(margins, side), '0');
	assert.equal(nodes(document, 'headerReference').length, 0);
	assert.equal(nodes(document, 'footerReference').length, 0);
}

function spacing(
	paragraph: Element,
	line: number,
	after = 0,
	rule = 'exact',
): void {
	const properties = nodes(paragraph, 'spacing')[0];
	assert.equal(value(properties, 'line'), String(line));
	assert.equal(value(properties, 'lineRule'), rule);
	assert.equal(value(properties, 'before'), '0');
	assert.equal(value(properties, 'after'), String(after));
}

function font(paragraph: Element, family: string, size: number): void {
	for (const run of nodes(paragraph, 'r').filter(
		run => nodes(run, 't').length > 0,
	)) {
		assert.equal(value(nodes(run, 'rFonts')[0], 'ascii'), family);
		assert.equal(value(nodes(run, 'sz')[0], 'val'), String(size));
	}
}

async function inspect(
	filename: string,
	run: (document: Document, archive: AdmZip) => void,
): Promise<void> {
	const archive = new AdmZip(filename);
	const dom = new JSDOM(archive.readAsText('word/document.xml'), {
		contentType: 'text/xml',
	});
	try {
		run(dom.window.document, archive);
	} finally {
		dom.window.close();
	}
}

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0150-'),
	);
	try {
		for (const kind of [
			'center1',
			'center3',
			'bottom1',
			'bottom-after6',
			'long-center',
		] as const) {
			const filename = path.join(directory, `${kind}.docx`);
			await buildWordcraft0150TableFixture(filename, kind);
			await inspect(filename, document => {
				page(document, 8000, 7200, 720);
				assert.equal(nodes(document, 'tbl').length, 1);
				assert.equal(nodes(document, 'tr').length, 1);
				assert.equal(nodes(document, 'tblStyle').length, 0);
				assert.equal(value(nodes(document, 'tblW')[0], 'w'), '6560');
				assert.deepEqual(
					nodes(document, 'gridCol').map(node => value(node, 'w')),
					['3280', '3280'],
				);
				for (const name of ['top', 'bottom', 'left', 'right'])
					assert.equal(
						value(
							nodes(nodes(document, 'tblCellMar')[0], name)[0],
							'w',
						),
						'0',
					);
				assert.equal(
					value(nodes(document, 'cantSplit')[0], 'val'),
					'off',
				);
				const cells = nodes(document, 'tc');
				assert.equal(cells.length, 2);
				const leftCount =
					kind === 'center3' ? 3 : kind === 'long-center' ? 25 : 1;
				assert.equal(
					value(nodes(cells[0], 'vAlign')[0], 'val'),
					kind.startsWith('bottom') ? 'bottom' : 'center',
				);
				assert.equal(value(nodes(cells[1], 'vAlign')[0], 'val'), 'top');
				for (const [index, count] of [leftCount, 30].entries()) {
					const paragraphs = nodes(cells[index], 'p');
					assert.equal(paragraphs.length, count);
					assert.deepEqual(
						paragraphs.map(p => p.textContent),
						Array.from(
							{ length: count },
							(_, i) => `${index === 0 ? 'LEFT' : 'RIGHT'}-${i}`,
						),
					);
					for (const paragraph of paragraphs) {
						spacing(
							paragraph,
							240,
							index === 0 && kind === 'bottom-after6' ? 120 : 0,
						);
						assert.equal(
							value(nodes(paragraph, 'jc')[0], 'val'),
							'center',
						);
						font(paragraph, 'Times New Roman', 24);
						for (const flag of [
							'widowControl',
							'keepNext',
							'keepLines',
						])
							assert.equal(
								value(nodes(paragraph, flag)[0], 'val'),
								'false',
							);
					}
				}
				const filler = nodes(document, 'body')[0].children[0];
				assert.equal(filler.localName, 'p');
				assert.equal(filler.textContent, 'FILLER');
				spacing(filler, 2000);
				assert.equal(value(nodes(filler, 'jc')[0], 'val'), 'left');
			});
			console.log(
				`PASS 0150 ${kind}: frozen page boundary and split-cell inputs`,
			);
		}
		for (const [kind, room, minimum, pictureHeight, count] of [
			['room214', 214, 193.45, 203, 1],
			['room260', 260, 193.45, 203, 1],
			['split-text', 225, 100, 40, 30],
			['tall-picture', 648, 0, 700, 60],
		] as const) {
			const filename = path.join(directory, `${kind}.docx`);
			await buildWordcraft0150PictureFixture(filename, kind);
			await inspect(filename, (document, archive) => {
				page(document, 12240, 15840, 1440);
				const rows = nodes(document, 'tr');
				assert.equal(rows.length, 2);
				assert.deepEqual(
					nodes(document, 'gridCol').map(node => value(node, 'w')),
					['3120', '3120', '3120'],
				);
				assert.equal(value(nodes(document, 'tblW')[0], 'w'), '9360');
				assert.equal(
					value(nodes(rows[1], 'trHeight')[0], 'val'),
					String(minimum * 20),
				);
				assert.equal(
					value(nodes(rows[1], 'trHeight')[0], 'hRule'),
					'atLeast',
				);
				assert.equal(
					value(nodes(rows[1], 'cantSplit')[0], 'val'),
					'off',
				);
				assert.equal(nodes(rows[0], 'tc').length, 3);
				for (const paragraph of nodes(rows[0], 'p')) {
					assert.equal(paragraph.textContent, '');
					spacing(paragraph, 280);
				}
				const cells = nodes(rows[1], 'tc');
				assert.equal(cells.length, 3);
				const picture = nodes(cells[0], 'p');
				assert.equal(picture.length, 1);
				spacing(picture[0], 240, 0, 'auto');
				const extents = [
					...document.getElementsByTagNameNS(DRAWING, 'extent'),
				];
				assert.equal(extents.length, 1);
				assert.equal(
					extents[0].getAttribute('cx'),
					String(114 * 12700),
				);
				assert.equal(
					extents[0].getAttribute('cy'),
					String(pictureHeight * 12700),
				);
				assert.equal(
					archive
						.getEntries()
						.filter(
							entry =>
								!entry.isDirectory &&
								entry.entryName.startsWith('word/media/'),
						).length,
					1,
				);
				for (const cell of cells.slice(1)) {
					const paragraphs = nodes(cell, 'p');
					assert.equal(paragraphs.length, count);
					assert.deepEqual(
						paragraphs.map(p => p.textContent),
						Array.from({ length: count }, (_, i) => `N/A ${i + 1}`),
					);
					for (const paragraph of paragraphs) {
						spacing(paragraph, 280);
						font(paragraph, 'Times New Roman', 24);
					}
				}
				const body = nodes(document, 'body')[0];
				assert.equal(
					body.children[0].localName,
					room === 648 ? 'tbl' : 'p',
				);
				const filler = [...body.children].find(
					node => node.localName === 'p',
				);
				assert.ok(filler);
				assert.equal(filler.textContent, 'Text above the table');
				spacing(filler, 280, room === 648 ? 0 : (648 - room - 14) * 20);
			});
			console.log(
				`PASS 0150 ${kind}: inline picture, at-least row and text controls`,
			);
		}
		for (const [family, size] of [
			['Times New Roman', 12],
			['Arial', 14],
		] as const) {
			const filename = path.join(directory, `tabs-${size}.docx`);
			await buildWordcraft0150TabFixture(filename, family, size);
			await inspect(filename, document => {
				page(document, 12240, 15840, 1440);
				const paragraphs = nodes(document, 'p');
				assert.equal(paragraphs.length, 14);
				for (const [index, paragraph] of paragraphs.entries()) {
					spacing(paragraph, 360);
					font(paragraph, family, size * 2);
					const tabs = nodes(paragraph, 'tab');
					assert.equal(
						tabs.length,
						2,
						'one paragraph stop and one run tab',
					);
					assert.equal(value(tabs[0], 'val'), 'right');
					assert.equal(
						value(tabs[0], 'leader'),
						index < 12 ? 'dot' : index === 12 ? 'none' : null,
					);
					assert.equal(
						value(tabs[0], 'pos'),
						String(
							index < 12 ? [1040, 5760, 8134][index % 3] : 5760,
						),
					);
					assert.deepEqual(
						nodes(paragraph, 't').map(node => node.textContent),
						[
							index < 12
								? [
										'E',
										'Entr',
										'Entry one',
										'Entry number two',
									][Math.floor(index / 3)]
								: 'Entry',
							'12',
						],
					);
				}
			});
			console.log(
				`PASS 0150 tabs ${family} ${size}pt: 12 dot stops and two negative leader controls`,
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
