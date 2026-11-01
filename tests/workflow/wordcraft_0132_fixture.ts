import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
	AlignmentType,
	Document,
	Footer,
	ImageRun,
	Packer,
	PageNumber,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';
import { JSDOM } from 'jsdom';

import { getStoStyles, MARGINS, STO_NUMBERING } from '@/shared/config';

const COLUMN_WIDTHS = [3000, 2000, 500, 500]; // [150, 100, 25, 25] pt.
// An opaque public one-pixel PNG stretched to the upstream 300 x 30 pt banner.
const BANNER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSFgAAAHEASFiX4r9AAAAAElFTkSuQmCC',
	'base64',
);

function textCell(width: number, preferred: boolean, text = 'A'): TableCell {
	return new TableCell({
		width: preferred ? { size: width, type: WidthType.DXA } : undefined,
		children: [
			new Paragraph({
				style: 'TableTextCenter',
				alignment: AlignmentType.CENTER,
				children: [
					new TextRun({
						text,
						font: 'Times New Roman',
						size: 28,
					}),
				],
			}),
		],
	});
}

function bannerTable(preferred: boolean, image: boolean): Table {
	return new Table({
		width: {
			size: preferred ? 6000 : 0,
			type: preferred ? WidthType.DXA : WidthType.AUTO,
		},
		columnWidths: COLUMN_WIDTHS,
		layout: TableLayoutType.AUTOFIT,
		margins: { top: 57, bottom: 57, left: 108, right: 108 },
		rows: [
			...(image
				? [
						new TableRow({
							tableHeader: true,
							children: [
								new TableCell({
									columnSpan: 4,
									width: preferred
										? { size: 6000, type: WidthType.DXA }
										: undefined,
									children: [
										new Paragraph({
											style: 'TableTextCenter',
											alignment: AlignmentType.CENTER,
											children: [
												new ImageRun({
													type: 'png',
													data: BANNER,
													transformation: {
														width: 400,
														height: 40,
													},
												}),
											],
										}),
									],
								}),
							],
						}),
					]
				: [
						new TableRow({
							tableHeader: true,
							children: COLUMN_WIDTHS.map((width, index) =>
								textCell(width, preferred, String(index + 1)),
							),
						}),
					]),
			new TableRow({
				children: COLUMN_WIDTHS.map(width =>
					textCell(width, preferred),
				),
			}),
		],
	});
}

/** Public #1883 controls adapted to STO padding: preferred banner, auto and text minimum. */
export async function buildWordcraft0132Fixture(
	outputDocx: string,
): Promise<void> {
	const document = new Document({
		title: 'Wordcraft 0.13.2 merged-cell width controls',
		subject: 'Public renderer regression fixture',
		styles: getStoStyles('samara-template-2022'),
		numbering: STO_NUMBERING,
		sections: [
			{
				properties: {
					titlePage: true,
					page: {
						size: { width: 11906, height: 16838 },
						margin: MARGINS,
					},
				},
				footers: {
					default: new Footer({
						children: [
							new Paragraph({
								style: 'a8',
								alignment: AlignmentType.CENTER,
								children: [
									new TextRun({
										style: 'aa',
										children: [PageNumber.CURRENT],
									}),
								],
							}),
						],
					}),
					first: new Footer({ children: [new Paragraph('')] }),
				},
				children: [
					new Paragraph('WORDCRAFT-0132-START'),
					...[
						['MERGED-PREFERRED', true, true],
						['MERGED-AUTO', false, true],
						['TEXT-MINIMUM', false, false],
					].flatMap(([marker, preferred, image], index) => [
						new Paragraph({
							text: `Таблица ${index + 1} – ${marker}`,
							style: 'TableCaption',
						}),
						bannerTable(Boolean(preferred), Boolean(image)),
					]),
					new Paragraph('WORDCRAFT-0132-END'),
				],
			},
		],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	// docx derives tcW from grid widths even when the caller omits cell widths.
	// Remove those derived preferences so the auto controls match #1883 inputs.
	const archive = new AdmZip(await Packer.toBuffer(document));
	const dom = new JSDOM(archive.readAsText('word/document.xml'), {
		contentType: 'text/xml',
	});
	try {
		const word =
			'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
		const tables = [
			...dom.window.document.getElementsByTagNameNS(word, 'tbl'),
		];
		for (const table of tables.slice(1))
			for (const width of [...table.getElementsByTagNameNS(word, 'tcW')])
				width.remove();
		archive.updateFile('word/document.xml', Buffer.from(dom.serialize()));
	} finally {
		dom.window.close();
	}
	archive.writeZip(outputDocx);
}
