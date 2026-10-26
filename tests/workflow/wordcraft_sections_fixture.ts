import fs from 'node:fs';
import path from 'node:path';
import {
	AlignmentType,
	Document,
	Footer,
	Header,
	NumberFormat,
	Packer,
	PageNumber,
	Paragraph,
	SectionType,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';

import {
	getStoStyles,
	MARGINS,
	STO_NUMBERING,
	StoStylePreset,
} from '@/shared/config';

function header(label: string): Header {
	return new Header({ children: [new Paragraph(label)] });
}

function footer(label: string): Footer {
	return new Footer({
		children: [
			new Paragraph({
				alignment: AlignmentType.CENTER,
				children: [
					new TextRun({
						children: [`${label} `, PageNumber.CURRENT],
					}),
				],
			}),
		],
	});
}

function sectionProperties(roman = false) {
	return {
		type: SectionType.NEXT_PAGE,
		titlePage: true,
		page: {
			size: { width: 11906, height: 16838 },
			margin: MARGINS,
			pageNumbers: {
				start: 1,
				formatType: roman
					? NumberFormat.LOWER_ROMAN
					: NumberFormat.DECIMAL,
			},
		},
	};
}

function sectionStories(number: number) {
	return {
		headers: {
			first: header(`S${number}-FIRST-HEADER`),
			default: header(`S${number}-DEFAULT-HEADER`),
		},
		footers: {
			first: footer(`S${number}-FIRST-FOOTER`),
			default: footer(`S${number}-DEFAULT-FOOTER`),
		},
	};
}

function cell(text: string, columnSpan?: number, isHeader = false): TableCell {
	return new TableCell({
		columnSpan,
		children: text.split('\n').map(
			line =>
				new Paragraph({
					text: line,
					style: isHeader ? 'TableTextCenter' : 'TableText',
					alignment: isHeader ? AlignmentType.CENTER : undefined,
				}),
		),
	});
}

function dataTable(): Table {
	return new Table({
		width: { size: 9355, type: WidthType.DXA },
		columnWidths: [1300, 6755, 1300],
		layout: TableLayoutType.FIXED,
		rows: [
			new TableRow({
				tableHeader: true,
				children: [
					cell('ROW', undefined, true),
					cell('SECTION-3-TABLE-HEADER', undefined, true),
					cell('VALUE', undefined, true),
				],
			}),
			...Array.from(
				{ length: 40 },
				(_, index) =>
					new TableRow({
						cantSplit: true,
						children: [
							cell(String(index + 1)),
							cell(
								`SECTION-3-ROW-${index + 1}\nCELL-LINE-${index + 1}-B\nCELL-LINE-${index + 1}-C`,
							),
							cell(String((index + 1) * 3)),
						],
					}),
			),
		],
	});
}

/** Public engine-capability control; section numbering is deliberately outside report policy. */
export async function buildWordcraftSectionFixture(
	outputDocx: string,
	stylePreset: StoStylePreset = 'samara-template-2022',
): Promise<void> {
	const document = new Document({
		styles: getStoStyles(stylePreset),
		numbering: STO_NUMBERING,
		sections: [
			{
				properties: sectionProperties(),
				...sectionStories(1),
				children: [
					new Paragraph('SECTION-1-START'),
					new Paragraph('PUBLIC ENGINE CAPABILITY CONTROL'),
					new Paragraph({
						text: 'SECTION-1-SECOND-PAGE',
						pageBreakBefore: true,
					}),
					new Paragraph('SECTION-1-END'),
				],
			},
			{
				properties: sectionProperties(true),
				...sectionStories(2),
				children: [
					new Paragraph('SECTION-2-START'),
					new Paragraph({
						text: 'Таблица 1 – SECTION-2-MERGE',
						style: 'TableCaption',
					}),
					new Table({
						columnWidths: [3100, 3100, 3155],
						rows: [
							new TableRow({
								tableHeader: true,
								children: [
									cell('MERGED-HEADER', 2, true),
									cell('VALUE', undefined, true),
								],
							}),
							new TableRow({
								children: [
									cell('LEFT'),
									cell('MIDDLE'),
									cell('RIGHT'),
								],
							}),
						],
					}),
					new Paragraph({
						text: 'SECTION-2-SECOND-PAGE',
						pageBreakBefore: true,
					}),
					new Paragraph('SECTION-2-END'),
				],
			},
			{
				properties: sectionProperties(),
				...sectionStories(3),
				children: [
					new Paragraph('SECTION-3-START'),
					new Paragraph({
						text: 'Таблица 2 – SECTION-3-DATA',
						style: 'TableCaption',
					}),
					dataTable(),
					new Paragraph('SECTION-3-END'),
				],
			},
		],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}
