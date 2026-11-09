import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	buildWordcraft0170ContextualFixture,
	buildWordcraft0170ContinuousFixture,
	buildWordcraft0170NestedTableFixture,
	buildWordcraft0170PictureFixture,
	buildWordcraft0170ScriptFixture,
	buildWordcraft0170SequenceFixture,
	WORDCRAFT_0170_CONTEXTUAL_CASES,
	WORDCRAFT_0170_PICTURE_CASES,
	WORDCRAFT_0170_SCRIPT_SIZES,
	WORDCRAFT_0170_SEQUENCE_CASES,
} from './wordcraft_0170_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string) =>
	element.getAttributeNS(WORD, name);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-wordcraft-0170-'));

async function inspect(
	name: string,
	build: (output: string) => Promise<void>,
	check: (document: Document) => void,
): Promise<void> {
	const output = path.join(directory, `${name}.docx`);
	await build(output);
	const archive = new AdmZip(output);
	const dom = new JSDOM(archive.readAsText('word/document.xml'), {
		contentType: 'text/xml',
	});
	try {
		const document = dom.window.document;
		assert.ok(nodes(document, 'p').length > 0);
		for (const margin of nodes(document, 'pgMar')) {
			for (const side of ['top', 'bottom', 'left', 'right'])
				assert.equal(value(margin, side), '1440');
			for (const side of ['header', 'footer', 'gutter'])
				assert.equal(value(margin, side), '0');
		}
		for (const size of nodes(document, 'pgSz')) {
			assert.equal(value(size, 'w'), '12240');
			assert.equal(value(size, 'h'), '15840');
		}
		for (const bold of nodes(document, 'b'))
			assert.equal(value(bold, 'val'), 'false');
		for (const text of [
			...nodes(document, 't'),
			...nodes(document, 'delText'),
		]) {
			const run = text.parentElement;
			assert.ok(run);
			assert.equal(value(nodes(run, 'rFonts')[0], 'ascii'), 'Arial');
			assert.ok(Number(value(nodes(run, 'sz')[0], 'val')) > 0);
		}
		for (const table of nodes(document, 'tbl')) {
			const firstRow = [...table.children].find(
				child => child.localName === 'tr',
			);
			assert.ok(firstRow);
			for (const paragraph of nodes(firstRow, 'p'))
				assert.equal(value(nodes(paragraph, 'jc')[0], 'val'), 'center');
		}
		assert.equal(nodes(document, 'headerReference').length, 0);
		assert.equal(nodes(document, 'footerReference').length, 0);
		check(document);
		console.log(
			`PASS 0170 ${name}: controlled DOCX XML (renderer acceptance is separate)`,
		);
	} finally {
		dom.window.close();
	}
}

async function main(): Promise<void> {
	try {
		await inspect('scripts', buildWordcraft0170ScriptFixture, document => {
			const paragraphs = nodes(document, 'p');
			assert.equal(paragraphs.length, 11);
			assert.deepEqual(
				WORDCRAFT_0170_SCRIPT_SIZES.map(
					size => Math.round(size * 0.65 * 2) / 2,
				),
				[5, 6, 6.5, 7, 8, 8.5, 9, 10.5, 13, 15.5, 23.5],
			);
			for (const [index, size] of WORDCRAFT_0170_SCRIPT_SIZES.entries()) {
				assert.deepEqual(
					nodes(paragraphs[index], 'vertAlign').map(node =>
						value(node, 'val'),
					),
					['superscript', 'subscript'],
				);
				assert.deepEqual(
					nodes(paragraphs[index], 'sz').map(node =>
						value(node, 'val'),
					),
					Array(4).fill(String(size * 2)),
				);
				assert.equal(nodes(paragraphs[index], 'position').length, 0);
			}
		});
		await inspect(
			'contextual',
			buildWordcraft0170ContextualFixture,
			document => {
				const tables = nodes(document, 'tbl');
				assert.equal(tables.length, 5);
				for (const [
					index,
					item,
				] of WORDCRAFT_0170_CONTEXTUAL_CASES.entries()) {
					const paragraphs = nodes(tables[index], 'p');
					assert.equal(paragraphs.length, 2);
					assert.equal(
						value(nodes(paragraphs[1], 'pStyle')[0], 'val'),
						item.style,
					);
					assert.equal(
						value(nodes(paragraphs[1], 'spacing')[0], 'after'),
						'240',
					);
					const contextual = nodes(
						paragraphs[1],
						'contextualSpacing',
					);
					assert.equal(
						contextual.length,
						item.contextual === null ? 0 : 1,
					);
					if (item.contextual !== null)
						assert.equal(
							value(contextual[0], 'val'),
							item.contextual,
						);
				}
			},
		);
		await inspect(
			'continuous',
			buildWordcraft0170ContinuousFixture,
			document => {
				const paragraphs = nodes(document, 'p');
				assert.deepEqual(
					paragraphs.map(node => node.textContent),
					['Cover', '', 'Heading', 'Body'],
				);
				assert.equal(nodes(paragraphs[1], 'sectPr').length, 1);
				assert.equal(nodes(paragraphs[2], 'pageBreakBefore').length, 1);
				const sections = nodes(document, 'sectPr');
				assert.equal(sections.length, 2);
				assert.equal(
					value(nodes(sections[1], 'type')[0], 'val'),
					'continuous',
				);
				assert.equal(nodes(document, 'br').length, 0);
			},
		);
		await inspect(
			'pictures',
			buildWordcraft0170PictureFixture,
			document => {
				const paragraphs = nodes(document, 'p');
				assert.equal(paragraphs.length, 24);
				const drawingProperties = [
					...document.getElementsByTagNameNS(DRAWING, 'docPr'),
				];
				assert.equal(drawingProperties.length, 8);
				assert.equal(
					new Set(
						drawingProperties.map(node => node.getAttribute('id')),
					).size,
					8,
				);
				assert.equal(
					new Set(
						drawingProperties.map(node =>
							node.getAttribute('name'),
						),
					).size,
					8,
				);
				for (const [
					index,
					item,
				] of WORDCRAFT_0170_PICTURE_CASES.entries()) {
					assert.equal(
						paragraphs[index * 3].textContent,
						`BEFORE ${item.id}`,
					);
					assert.equal(
						paragraphs[index * 3 + 2].textContent,
						`AFTER ${item.id}`,
					);
					const picture = paragraphs[index * 3 + 1];
					assert.equal(picture.textContent, item.mixed ? 'x' : '');
					assert.equal(
						value(nodes(picture, 'spacing')[0], 'line'),
						String(item.line),
					);
					assert.equal(
						value(nodes(picture, 'spacing')[0], 'lineRule'),
						item.rule,
					);
					assert.equal(
						value(nodes(picture, 'position')[0], 'val'),
						'-60',
					);
					const extent = picture.getElementsByTagNameNS(
						DRAWING,
						'extent',
					)[0];
					assert.equal(extent.getAttribute('cy'), String(6 * 12700));
					assert.equal(extent.getAttribute('cx'), String(40 * 12700));
				}
			},
		);
		await inspect(
			'sequence',
			buildWordcraft0170SequenceFixture,
			document => {
				const paragraphs = nodes(document, 'p');
				assert.equal(paragraphs.length, 8);
				assert.deepEqual(
					WORDCRAFT_0170_SEQUENCE_CASES.map(item => item.expected),
					['1', '9', '2', '1', '7', '3', '7', '6'],
				);
				for (const [
					index,
					item,
				] of WORDCRAFT_0170_SEQUENCE_CASES.entries()) {
					const field = paragraphs[index];
					assert.equal(
						nodes(field, 'instrText').length,
						item.deleted ? 0 : 1,
					);
					assert.equal(
						nodes(field, 'delInstrText').length,
						item.deleted ? 1 : 0,
					);
					assert.equal(
						nodes(
							field,
							item.deleted ? 'delInstrText' : 'instrText',
						)[0].textContent?.trim(),
						item.instruction,
					);
					assert.deepEqual(
						nodes(field, 'fldChar').map(node =>
							value(node, 'fldCharType'),
						),
						['begin', 'separate', 'end'],
					);
					assert.equal(
						value(nodes(field, 'fldChar')[0], 'fldLock'),
						item.locked ? 'true' : null,
					);
					assert.equal(
						nodes(field, 'del').length,
						item.deleted ? 1 : 0,
					);
					assert.equal(
						nodes(field, item.deleted ? 'delText' : 't').at(-1)
							?.textContent,
						item.cached,
					);
				}
				assert.doesNotMatch(
					document.documentElement.outerHTML,
					/STYLEREF|REF /,
				);
			},
		);
		await inspect(
			'nested-table',
			buildWordcraft0170NestedTableFixture,
			document => {
				const tables = nodes(document, 'tbl');
				assert.equal(tables.length, 6);
				assert.equal(nodes(document, 'sectPr').length, 3);
				for (const [index, count] of [20, 20, 60].entries()) {
					const nested = tables[index * 2 + 1];
					assert.equal(nodes(nested, 'p').length, count);
					assert.equal(
						value(nodes(nested, 'cantSplit')[0], 'val'),
						index === 1 ? 'false' : 'true',
					);
					assert.equal(nodes(nested, 'tr').length, 1);
				}
			},
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
