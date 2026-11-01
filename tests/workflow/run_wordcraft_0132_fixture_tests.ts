import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { MARGINS } from '@/shared/config';
import { validateSTO } from '@/shared/lib/sto-validator';

import { buildWordcraft0132Fixture } from './wordcraft_0132_fixture';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING =
	'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const nodes = (element: Element | Document, name: string): Element[] => [
	...element.getElementsByTagNameNS(WORD, name),
];
const value = (element: Element, name: string): string | null =>
	element.getAttributeNS(WORD, name);

async function main(): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-wordcraft-0132-'),
	);
	try {
		const filename = path.join(directory, 'merged-widths.docx');
		await buildWordcraft0132Fixture(filename);
		const archive = new AdmZip(filename);
		const unpacked = path.join(directory, 'unpacked');
		archive.extractAllTo(unpacked);
		const validation = validateSTO(unpacked);
		assert.ok(
			validation.length > 0,
			'full STO validator discovered checks',
		);
		assert.deepEqual(
			validation.filter(result => !result.passed),
			[],
			'source passes all STO XML checks',
		);
		const dom = new JSDOM(archive.readAsText('word/document.xml'), {
			contentType: 'text/xml',
		});
		try {
			const document = dom.window.document;
			const tables = nodes(document, 'tbl');
			assert.equal(
				tables.length,
				3,
				'all three width controls discovered',
			);
			for (const [index, table] of tables.entries()) {
				assert.deepEqual(
					nodes(table, 'gridCol').map(node =>
						Number(value(node, 'w')),
					),
					[3000, 2000, 500, 500],
				);
				assert.equal(
					value(nodes(table, 'tblLayout')[0], 'type'),
					'autofit',
				);
				const margins = nodes(table, 'tblCellMar')[0];
				for (const side of ['top', 'bottom', 'left', 'right'])
					assert.equal(
						value(nodes(margins, side)[0], 'w'),
						side === 'top' || side === 'bottom' ? '57' : '108',
					);
				assert.equal(
					value(nodes(table, 'tblW')[0], 'type'),
					index === 0 ? 'dxa' : 'auto',
				);
				assert.equal(
					value(nodes(table, 'tblW')[0], 'w'),
					index === 0 ? '6000' : '0',
				);
				assert.deepEqual(
					nodes(table, 't').map(node => node.textContent),
					index < 2
						? ['A', 'A', 'A', 'A']
						: ['1', '2', '3', '4', 'A', 'A', 'A', 'A'],
				);
				const widths = nodes(table, 'tcW');
				assert.deepEqual(
					widths.map(node => Number(value(node, 'w'))),
					index === 0 ? [6000, 3000, 2000, 500, 500] : [],
				);
				for (const width of widths)
					assert.equal(value(width, 'type'), 'dxa');
				for (const paragraph of nodes(table, 'p')) {
					assert.equal(
						value(nodes(paragraph, 'pStyle')[0], 'val'),
						'TableTextCenter',
					);
					assert.equal(
						value(nodes(paragraph, 'jc')[0], 'val'),
						'center',
					);
				}
				for (const run of nodes(table, 'r').filter(
					run => nodes(run, 't').length > 0,
				)) {
					assert.equal(
						value(nodes(run, 'rFonts')[0], 'ascii'),
						'Times New Roman',
					);
					assert.equal(value(nodes(run, 'sz')[0], 'val'), '28');
				}
				assert.equal(
					nodes(table, 'b').length,
					0,
					'fixture body is not bold',
				);
				const rows = nodes(table, 'tr');
				assert.equal(rows.length, 2);
				assert.equal(
					nodes(rows[1], 'tblHeader').length,
					0,
					'table has a non-header data row',
				);
				assert.deepEqual(
					nodes(rows[1], 't').map(node => node.textContent),
					['A', 'A', 'A', 'A'],
				);
				assert.equal(nodes(rows[0], 'tblHeader').length, 1);
				const spans = nodes(table, 'gridSpan');
				assert.equal(spans.length, index < 2 ? 1 : 0);
				const extents = [
					...table.getElementsByTagNameNS(DRAWING, 'extent'),
				];
				assert.equal(extents.length, index < 2 ? 1 : 0);
				if (index < 2) {
					assert.equal(value(spans[0], 'val'), '4');
					assert.equal(nodes(rows[0], 'tc').length, 1);
					assert.equal(nodes(rows[0], 'tblHeader').length, 1);
					assert.equal(
						extents[0].getAttribute('cx'),
						String(300 * 12700),
					);
					assert.equal(
						extents[0].getAttribute('cy'),
						String(30 * 12700),
					);
				}
				assert.equal(nodes(rows.at(-1)!, 'tc').length, 4);
			}
			for (const marker of [
				'MERGED-PREFERRED',
				'MERGED-AUTO',
				'TEXT-MINIMUM',
				'WORDCRAFT-0132-START',
				'WORDCRAFT-0132-END',
			])
				assert.ok(
					document.documentElement.textContent?.includes(marker),
					`marker survives: ${marker}`,
				);
			assert.equal(value(nodes(document, 'pgSz')[0], 'w'), '11906');
			assert.equal(value(nodes(document, 'pgSz')[0], 'h'), '16838');
			for (const [side, margin] of Object.entries(MARGINS))
				assert.equal(
					value(nodes(document, 'pgMar')[0], side),
					String(margin),
				);
			assert.ok(
				archive
					.getEntries()
					.some(entry => entry.entryName.startsWith('word/media/')),
			);
			console.log(
				'PASS Wordcraft 0.13.2 fixture: merged 300pt image, asymmetric preferred widths, equivalent auto and text controls, centered headers, source text and STO geometry',
			);
		} finally {
			dom.window.close();
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
