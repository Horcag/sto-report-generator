import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	buildWordcraft0160FieldFixture,
	buildWordcraft0160FootnoteFixture,
	buildWordcraft0160PictureFixture,
	buildWordcraft0160TabFixture,
	WORDCRAFT_0160_FIELDS,
	WORDCRAFT_0160_PICTURE_CASES,
} from './wordcraft_0160_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string) =>
	element.getAttributeNS(WORD, name);

function inspect(
	filename: string,
	test: (document: Document, archive: AdmZip) => void,
): void {
	const archive = new AdmZip(filename);
	const dom = new JSDOM(archive.readAsText('word/document.xml'), {
		contentType: 'text/xml',
	});
	try {
		test(dom.window.document, archive);
	} finally {
		dom.window.close();
	}
}

function checkPage(document: Document, left: number[]): void {
	assert.equal(nodes(document, 'tbl').length, 0);
	assert.deepEqual(
		nodes(document, 'pgMar').map(margin => value(margin, 'left')),
		left.map(String),
	);
	for (const size of nodes(document, 'pgSz')) {
		assert.equal(value(size, 'w'), '12240');
		assert.equal(value(size, 'h'), '15840');
	}
	for (const margin of nodes(document, 'pgMar')) {
		for (const side of ['top', 'bottom', 'right'])
			assert.equal(value(margin, side), '1440');
		for (const side of ['header', 'footer', 'gutter'])
			assert.equal(value(margin, side), '0');
	}
	assert.equal(nodes(document, 'headerReference').length, 0);
	assert.equal(nodes(document, 'footerReference').length, 0);
}

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0160-'),
	);
	try {
		const fields = path.join(directory, 'fields.docx');
		await buildWordcraft0160FieldFixture(fields);
		inspect(fields, (document, archive) => {
			checkPage(document, [1440]);
			const numbering = archive.readAsText('word/numbering.xml');
			assert.match(numbering, /w:val="lowerLetter"/);
			assert.match(numbering, /w:val="\(%3\)"/);
			const paragraphs = nodes(document, 'p');
			assert.equal(paragraphs.length, 6 + WORDCRAFT_0160_FIELDS.length);
			assert.equal(paragraphs[1].textContent, 'Chapter One');
			assert.equal(
				value(nodes(paragraphs[1], 'pStyle')[0], 'val'),
				'FixtureHeading',
			);
			const styles = new JSDOM(archive.readAsText('word/styles.xml'), {
				contentType: 'text/xml',
			});
			try {
				const style = nodes(styles.window.document, 'style').find(
					node => value(node, 'styleId') === 'FixtureHeading',
				);
				assert.ok(style);
				assert.equal(value(style, 'type'), 'paragraph');
				assert.equal(
					value(nodes(style, 'name')[0], 'val'),
					'FixtureHeading',
				);
				assert.equal(
					value(nodes(style, 'basedOn')[0], 'val'),
					'Normal',
				);
				assert.equal(
					value(nodes(style, 'rFonts')[0], 'ascii'),
					'Arial',
				);
				assert.equal(value(nodes(style, 'sz')[0], 'val'), '20');
				assert.equal(value(nodes(style, 'b')[0], 'val'), 'false');
			} finally {
				styles.window.close();
			}
			assert.equal(
				nodes(paragraphs[7], 'instrText')[0].textContent?.trim(),
				'STYLEREF "FixtureHeading"',
			);
			assert.equal(
				value(nodes(paragraphs[2], 'bookmarkStart')[0], 'name'),
				'Mark',
			);
			assert.equal(paragraphs[2].textContent, 'Target words');
			assert.equal(nodes(paragraphs[2], 'bookmarkEnd').length, 1);
			for (const [index, field] of WORDCRAFT_0160_FIELDS.entries()) {
				const paragraph = paragraphs[index + 6];
				assert.equal(
					nodes(paragraph, 'instrText')[0].textContent?.trim(),
					field.instruction,
				);
				assert.deepEqual(
					nodes(paragraph, 'fldChar').map(node =>
						value(node, 'fldCharType'),
					),
					['begin', 'separate', 'end'],
				);
				assert.equal(
					value(nodes(paragraph, 'fldChar')[0], 'fldLock'),
					'locked' in field ? 'true' : null,
				);
				assert.equal(
					nodes(paragraph, 't')[0].textContent,
					field.cached,
				);
			}
			assert.doesNotMatch(document.documentElement.outerHTML, /FIELD-\d/);
		});
		console.log(
			'PASS 0160 fields: eight real complex fields with stale and locked caches',
		);
		for (const kind of ['nextPage', 'evenPage', 'oddPage'] as const) {
			const filename = path.join(directory, `${kind}.docx`);
			await buildWordcraft0160FootnoteFixture(filename, kind);
			inspect(filename, (document, archive) => {
				checkPage(document, [1440, 2880]);
				assert.equal(nodes(document, 'sectPr').length, 2);
				assert.equal(
					value(
						nodes(nodes(document, 'sectPr')[1], 'type')[0],
						'val',
					),
					kind,
				);
				const first = nodes(document, 'p')[0];
				assert.equal(first.textContent, 'Section one text.');
				assert.equal(
					value(nodes(first, 'footnoteReference')[0], 'id'),
					'1',
				);
				assert.equal(nodes(first, 't')[0].textContent, 'Secti');
				assert.match(
					archive.readAsText('word/footnotes.xml'),
					/The note text\./,
				);
			});
			console.log(
				`PASS 0160 ${kind}: first-section footnote and distinct 72/144 pt margins`,
			);
		}
		const picture = path.join(directory, 'pictures.docx');
		await buildWordcraft0160PictureFixture(picture);
		inspect(picture, document => {
			checkPage(document, [1440]);
			const paragraphs = nodes(document, 'p');
			assert.equal(
				paragraphs.length,
				WORDCRAFT_0160_PICTURE_CASES.length * 3,
			);
			for (const [
				index,
				item,
			] of WORDCRAFT_0160_PICTURE_CASES.entries()) {
				assert.equal(
					paragraphs[index * 3].textContent,
					`BEFORE ${item.id}`,
				);
				assert.equal(
					paragraphs[index * 3 + 2].textContent,
					`AFTER ${item.id}`,
				);
				const image = paragraphs[index * 3 + 1];
				assert.equal(
					nodes(image, 't')
						.map(node => node.textContent)
						.join(''),
					item.lead,
				);
				assert.equal(
					value(nodes(image, 'spacing')[0], 'line'),
					String(item.line),
				);
				assert.equal(
					value(nodes(image, 'spacing')[0], 'lineRule'),
					'auto',
				);
				assert.equal(value(nodes(image, 'spacing')[0], 'before'), '0');
				assert.equal(value(nodes(image, 'spacing')[0], 'after'), '0');
				const imageRun = nodes(image, 'r').find(
					run => nodes(run, 'drawing').length > 0,
				);
				assert.ok(imageRun);
				assert.equal(
					value(nodes(imageRun, 'rFonts')[0], 'ascii'),
					'Arial',
				);
				assert.equal(
					value(nodes(imageRun, 'sz')[0], 'val'),
					String(item.size),
				);
				assert.equal(
					value(nodes(imageRun, 'position')[0], 'val'),
					String(item.position),
				);
				const extent = image.getElementsByTagNameNS(
					DRAWING,
					'extent',
				)[0];
				assert.equal(extent.getAttribute('cx'), String(40 * 12700));
				assert.equal(extent.getAttribute('cy'), String(30 * 12700));
			}
		});
		console.log(
			'PASS 0160 pictures: seven pure/spaces/text line inputs with explicit font, spacing and position',
		);
		const tabs = path.join(directory, 'tabs.docx');
		await buildWordcraft0160TabFixture(tabs);
		inspect(tabs, document => {
			checkPage(document, [1440]);
			const paragraphs = nodes(document, 'p');
			assert.equal(paragraphs.length, 12);
			for (const [index, paragraph] of paragraphs.entries()) {
				assert.equal(
					value(nodes(paragraph, 'jc')[0], 'val'),
					['left', 'center', 'right'][Math.floor(index / 4)],
				);
				const stops = nodes(nodes(paragraph, 'tabs')[0], 'tab');
				const configuration = index % 4;
				assert.deepEqual(
					stops.map(stop => value(stop, 'pos')),
					[['3600'], ['4680'], ['4680', '7290'], ['4680', '9360']][
						configuration
					],
				);
				assert.deepEqual(
					stops.map(stop => value(stop, 'val')),
					[
						['left'],
						['center'],
						['center', 'right'],
						['center', 'right'],
					][configuration],
				);
				assert.deepEqual(
					nodes(paragraph, 't').map(node => node.textContent),
					configuration < 2
						? ['Label', 'filename']
						: ['Label', 'filename', 'time'],
				);
				assert.equal(nodes(paragraph, 'tab').length, stops.length * 2);
			}
		});
		console.log(
			'PASS 0160 tabs: 12 ordinary text controls across left/center/right paragraph alignment',
		);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
		assert.equal(fs.existsSync(directory), false);
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
