import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
	AlignmentType,
	Document,
	ImportedXmlComponent,
	Packer,
	Paragraph,
	TextRun,
} from 'docx';
import { JSDOM } from 'jsdom';

import { getStoStyles, MARGINS, STO_NUMBERING } from '@/shared/config';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PAGE_WIDTH = 11906;
const NARROW_WIDTH = 600; // 30 pt in twips, deliberately narrower than Oremus.
const run = (text: string): TextRun =>
	new TextRun({ text, font: 'Times New Roman', size: 28 });

function bookmarkControl(offset?: number): Paragraph {
	const text = 'Oremus';
	const paragraph = new Paragraph({
		alignment: AlignmentType.LEFT,
		indent: {
			left: 0,
			firstLine: 0,
			right: PAGE_WIDTH - MARGINS.left - MARGINS.right - NARROW_WIDTH,
		},
	});
	if (offset === undefined) paragraph.addChildElement(run(text));
	else {
		if (offset > 0) paragraph.addChildElement(run(text.slice(0, offset)));
		for (let index = 0; index < (offset === 0 ? 2 : 1); index++) {
			const id = String(offset + index * 10);
			paragraph.addChildElement(
				new ImportedXmlComponent('w:bookmarkStart', {
					'w:id': id,
					'w:name': `WORDCRAFT0120_OFFSET_${offset}${index ? '_SECOND' : ''}`,
				}),
			);
			paragraph.addChildElement(
				new ImportedXmlComponent('w:bookmarkEnd', { 'w:id': id }),
			);
		}
		paragraph.addChildElement(run(text.slice(offset)));
	}
	return paragraph;
}

/** Public Wordcraft 0.12.0 controls; no personal report content or acceptance claims. */
export async function buildWordcraft0120Fixture(
	outputDocx: string,
	expand: boolean = true,
): Promise<void> {
	const document = new Document({
		title: 'Wordcraft 0.12.0 whitespace, bookmark and ShiftReturn controls',
		subject: 'Public renderer regression fixture',
		description: `Times New Roman 14 pt; NBSP/SPACE x10; Oremus in 30 pt; expandShiftReturn=${expand}`,
		styles: getStoStyles('samara-template-2022'),
		numbering: STO_NUMBERING,
		// docx omits false compatibility values. Normalize the single emitted
		// setting below so both controls carry an explicit OOXML 0/1 value.
		compatibility: { doNotExpandShiftReturn: true },
		sections: [
			{
				properties: {
					page: {
						size: { width: PAGE_WIDTH, height: 16838 },
						margin: MARGINS,
					},
				},
				children: [
					new Paragraph('WORDCRAFT-0120-START'),
					new Paragraph(
						`EXPAND-SHIFT-RETURN-${expand ? 'TRUE' : 'FALSE'}`,
					),
					new Paragraph('NBSP-10-START'),
					new Paragraph({
						alignment: AlignmentType.LEFT,
						children: [run(`A${'\u00a0'.repeat(10)}B`)],
					}),
					new Paragraph('SPACE-10-START'),
					new Paragraph({
						alignment: AlignmentType.LEFT,
						children: [run(`A${' '.repeat(10)}B`)],
					}),
					new Paragraph('BOOKMARK-PLAIN-START'),
					bookmarkControl(),
					new Paragraph('BOOKMARK-OFFSET-0-START'),
					bookmarkControl(0),
					new Paragraph('BOOKMARK-OFFSET-2-START'),
					bookmarkControl(2),
					new Paragraph('BOOKMARK-OFFSET-3-START'),
					bookmarkControl(3),
					new Paragraph('SHIFT-RETURN-START'),
					new Paragraph({
						alignment: AlignmentType.JUSTIFIED,
						children: [
							new TextRun({
								font: 'Times New Roman',
								size: 28,
								children: [
									'We tie the spend',
									new ImportedXmlComponent('w:br'),
									'to a pipe',
								],
							}),
						],
					}),
					new Paragraph('WORDCRAFT-0120-END'),
				],
			},
		],
	});
	const archive = new AdmZip(await Packer.toBuffer(document));
	const settings = new JSDOM(archive.readAsText('word/settings.xml'), {
		contentType: 'text/xml',
	});
	settings.window.document
		.getElementsByTagNameNS(WORD, 'doNotExpandShiftReturn')[0]
		.setAttributeNS(WORD, 'w:val', expand ? '0' : '1');
	archive.updateFile('word/settings.xml', Buffer.from(settings.serialize()));
	settings.window.close();
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	archive.writeZip(outputDocx);
}
