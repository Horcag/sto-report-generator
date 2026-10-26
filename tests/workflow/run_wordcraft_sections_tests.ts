import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { MARGINS, STO_STYLE_PRESET_NAMES } from '@/shared/config';

import { buildWordcraftSectionFixture } from './wordcraft_sections_fixture';

const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), 'sto-wordcraft-sections-'),
);
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (xml: string): Document =>
	new JSDOM(xml, { contentType: 'text/xml' }).window.document;

async function main(): Promise<void> {
	try {
		for (const preset of STO_STYLE_PRESET_NAMES) {
			const output = path.join(directory, `${preset}.docx`);
			await buildWordcraftSectionFixture(output, preset);
			const archive = new AdmZip(output);
			const document = parse(archive.readAsText('word/document.xml'));
			const styles = parse(archive.readAsText('word/styles.xml'));
			const definitions = parse(archive.readAsText('word/numbering.xml'));
			const ids = new Set(
				[...definitions.getElementsByTagNameNS(word, 'num')].map(node =>
					node.getAttributeNS(word, 'numId'),
				),
			);
			for (const id of [
				...styles.getElementsByTagNameNS(word, 'numId'),
			]) {
				const value = id.getAttributeNS(word, 'val');
				assert.match(
					value ?? '',
					/^\d+$/,
					'numbering placeholders must be resolved before Word opens DOCX',
				);
				assert.ok(
					ids.has(value),
					'style numbering refers to a concrete numbering definition',
				);
			}
			const sections = [
				...document.getElementsByTagNameNS(word, 'sectPr'),
			];
			assert.equal(
				sections.length,
				3,
				'three actual section definitions',
			);
			for (const [index, section] of sections.entries()) {
				const size = section.getElementsByTagNameNS(word, 'pgSz')[0];
				assert.equal(size.getAttributeNS(word, 'w'), '11906');
				assert.equal(size.getAttributeNS(word, 'h'), '16838');
				assert.equal(
					section
						.getElementsByTagNameNS(word, 'type')[0]
						.getAttributeNS(word, 'val'),
					'nextPage',
				);
				assert.equal(
					section.getElementsByTagNameNS(word, 'titlePg').length,
					1,
				);
				assert.equal(
					section.getElementsByTagNameNS(word, 'headerReference')
						.length,
					2,
				);
				assert.equal(
					section.getElementsByTagNameNS(word, 'footerReference')
						.length,
					2,
				);
				const numbering = section.getElementsByTagNameNS(
					word,
					'pgNumType',
				)[0];
				assert.equal(numbering.getAttributeNS(word, 'start'), '1');
				assert.equal(
					numbering.getAttributeNS(word, 'fmt'),
					index === 1 ? 'lowerRoman' : 'decimal',
				);
				const margins = section.getElementsByTagNameNS(
					word,
					'pgMar',
				)[0];
				for (const [name, value] of Object.entries(MARGINS)) {
					assert.equal(
						margins.getAttributeNS(word, name),
						String(value),
					);
				}
			}
			assert.equal(
				document.getElementsByTagNameNS(word, 'pageBreakBefore').length,
				2,
			);
			const tables = [...document.getElementsByTagNameNS(word, 'tbl')];
			assert.equal(tables.length, 2);
			let headerParagraphs = 0;
			let bodyParagraphs = 0;
			for (const table of tables) {
				for (const row of table.getElementsByTagNameNS(word, 'tr')) {
					const isHeader =
						row.getElementsByTagNameNS(word, 'tblHeader').length >
						0;
					for (const paragraph of row.getElementsByTagNameNS(
						word,
						'p',
					)) {
						const styleId = paragraph
							.getElementsByTagNameNS(word, 'pStyle')[0]
							?.getAttributeNS(word, 'val');
						assert.equal(
							styleId,
							isHeader ? 'TableTextCenter' : 'TableText',
						);
						const directAlignment = paragraph
							.getElementsByTagNameNS(word, 'jc')[0]
							?.getAttributeNS(word, 'val');
						const style = [
							...styles.getElementsByTagNameNS(word, 'style'),
						].find(
							node =>
								node.getAttributeNS(word, 'styleId') ===
								styleId,
						);
						const styleAlignment = style
							?.getElementsByTagNameNS(word, 'jc')[0]
							?.getAttributeNS(word, 'val');
						assert.equal(
							directAlignment ?? styleAlignment,
							isHeader ? 'center' : 'left',
						);
						if (isHeader) {
							assert.equal(
								directAlignment,
								'center',
								'header alignment is explicit, matching generator output',
							);
							headerParagraphs++;
						} else {
							assert.equal(
								directAlignment,
								undefined,
								'body keeps its inherited TableText alignment',
							);
							bodyParagraphs++;
						}
					}
				}
			}
			assert.equal(
				headerParagraphs,
				5,
				'all merged and ordinary header paragraphs checked',
			);
			assert.equal(
				bodyParagraphs,
				203,
				'all body paragraphs, including multiline cells, checked',
			);

			assert.equal(
				tables[0]
					.getElementsByTagNameNS(word, 'gridSpan')[0]
					.getAttributeNS(word, 'val'),
				'2',
			);
			assert.equal(
				tables[1].getElementsByTagNameNS(word, 'tr').length,
				41,
			);
			assert.equal(
				tables[1].getElementsByTagNameNS(word, 'tblHeader').length,
				1,
			);
			assert.equal(
				tables[1].getElementsByTagNameNS(word, 'cantSplit').length,
				40,
			);
			assert.ok(tables[1].textContent?.includes('SECTION-3-ROW-40'));
			assert.ok(tables[1].textContent?.includes('CELL-LINE-40-C'));
			for (const kind of ['header', 'footer']) {
				const stories = archive
					.getEntries()
					.filter(entry =>
						new RegExp(`^word/${kind}\\d+\\.xml$`).test(
							entry.entryName,
						),
					);
				assert.equal(stories.length, 6);
				const text = stories
					.map(entry => entry.getData().toString('utf8'))
					.join('');
				for (let section = 1; section <= 3; section++) {
					for (const role of ['FIRST', 'DEFAULT']) {
						assert.ok(
							text.includes(
								`S${section}-${role}-${kind.toUpperCase()}`,
							),
						);
					}
				}
				if (kind === 'footer') {
					for (const story of stories) {
						assert.match(
							story.getData().toString('utf8'),
							/<w:instrText[^>]*>PAGE<\/w:instrText>/,
						);
					}
				}
			}
			const stylesXml = archive.readAsText('word/styles.xml');
			for (const id of [
				'Normal',
				'StructuralHeading',
				'StructuralHeadingNoTOC',
				'TableText',
				'TOC1',
			]) {
				assert.ok(stylesXml.includes(`w:styleId="${id}"`));
			}
		}
		console.log(
			'Wordcraft section fixture tests passed: both presets, section numbering, stories, merged grid, centered headers, left-aligned body and 40 multiline rows.',
		);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
