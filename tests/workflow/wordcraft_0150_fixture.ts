import fs from 'node:fs';
import path from 'node:path';
import {
	AlignmentType,
	BorderStyle,
	Document,
	HeightRule,
	ImageRun,
	LeaderType,
	Packer,
	Paragraph,
	Tab,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TabStopType,
	TextRun,
	VerticalAlignTable,
	WidthType,
} from 'docx';

export type Wordcraft0150TableKind =
	'center1' | 'center3' | 'bottom1' | 'bottom-after6' | 'long-center';

function paragraph(
	text: string,
	line = 240,
	after = 0,
	alignment: 'left' | 'center' = AlignmentType.CENTER,
): Paragraph {
	return new Paragraph({
		alignment,
		indent: { left: 0, right: 0, firstLine: 0 },
		spacing: { before: 0, after, line, lineRule: 'exact' },
		keepNext: false,
		keepLines: false,
		widowControl: false,
		children: [new TextRun({ text, font: 'Times New Roman', size: 24 })],
	});
}

/** Separate files keep each split-row scenario at the same frozen page boundary. */
export async function buildWordcraft0150TableFixture(
	outputDocx: string,
	kind: Wordcraft0150TableKind,
): Promise<void> {
	const leftCount = kind === 'center3' ? 3 : kind === 'long-center' ? 25 : 1;
	const bottom = kind === 'bottom1' || kind === 'bottom-after6';
	const document = new Document({
		title: `Wordcraft 0.15.0 split row ${kind}`,
		subject: 'Public renderer regression fixture',
		sections: [
			{
				properties: {
					page: {
						size: { width: 8000, height: 7200 },
						margin: {
							top: 720,
							bottom: 720,
							left: 720,
							right: 720,
							header: 0,
							footer: 0,
							gutter: 0,
						},
					},
				},
				children: [
					paragraph('FILLER', 2000, 0, AlignmentType.LEFT),
					new Table({
						width: { size: 6560, type: WidthType.DXA },
						columnWidths: [3280, 3280],
						layout: TableLayoutType.FIXED,
						margins: { top: 0, bottom: 0, left: 0, right: 0 },
						rows: [
							new TableRow({
								cantSplit: false,
								children: [
									new TableCell({
										verticalAlign: bottom
											? VerticalAlignTable.BOTTOM
											: VerticalAlignTable.CENTER,
										children: Array.from(
											{ length: leftCount },
											(_, index) =>
												paragraph(
													`LEFT-${index}`,
													240,
													kind === 'bottom-after6'
														? 120
														: 0,
												),
										),
									}),
									new TableCell({
										verticalAlign: VerticalAlignTable.TOP,
										children: Array.from(
											{ length: 30 },
											(_, index) =>
												paragraph(`RIGHT-${index}`),
										),
									}),
								],
							}),
						],
					}),
				],
			},
		],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}

export type Wordcraft0150PictureKind =
	'room214' | 'room260' | 'split-text' | 'tall-picture';

const PICTURE = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSFgAAAHEASFiX4r9AAAAAElFTkSuQmCC',
	'base64',
);

function letterPage() {
	return {
		size: { width: 12240, height: 15840 },
		margin: {
			top: 1440,
			bottom: 1440,
			left: 1440,
			right: 1440,
			header: 0,
			footer: 0,
			gutter: 0,
		},
	};
}

/** Release #5161 geometry adapted to explicit Times New Roman 12 pt. */
export async function buildWordcraft0150PictureFixture(
	outputDocx: string,
	kind: Wordcraft0150PictureKind,
): Promise<void> {
	const [room, minimum, pictureHeight, textCount] = {
		room214: [214, 193.45, 203, 1],
		room260: [260, 193.45, 203, 1],
		'split-text': [225, 100, 40, 30],
		'tall-picture': [648, 0, 700, 60],
	}[kind];
	const text = (label: string, after = 0) =>
		new Paragraph({
			spacing: { before: 0, after, line: 280, lineRule: 'exact' },
			keepNext: false,
			keepLines: false,
			widowControl: false,
			children: [
				new TextRun({ text: label, font: 'Times New Roman', size: 24 }),
			],
		});
	const table = new Table({
		width: { size: 9360, type: WidthType.DXA },
		columnWidths: [3120, 3120, 3120],
		layout: TableLayoutType.FIXED,
		margins: { top: 0, bottom: 0, left: 108, right: 108 },
		borders: Object.fromEntries(
			[
				'top',
				'bottom',
				'left',
				'right',
				'insideHorizontal',
				'insideVertical',
			].map(side => [
				side,
				{ style: BorderStyle.SINGLE, size: 4, color: '000000' },
			]),
		),
		rows: [
			new TableRow({
				children: Array.from(
					{ length: 3 },
					() => new TableCell({ children: [text('')] }),
				),
			}),
			new TableRow({
				cantSplit: false,
				height: { value: minimum * 20, rule: HeightRule.ATLEAST },
				children: [
					new TableCell({
						children: [
							new Paragraph({
								spacing: {
									before: 0,
									after: 0,
									line: 240,
									lineRule: 'auto',
								},
								children: [
									new ImageRun({
										type: 'png',
										data: PICTURE,
										transformation: {
											width: (114 * 4) / 3,
											height: (pictureHeight * 4) / 3,
										},
									}),
								],
							}),
						],
					}),
					...Array.from(
						{ length: 2 },
						() =>
							new TableCell({
								children: Array.from(
									{ length: textCount },
									(_, index) => text(`N/A ${index + 1}`),
								),
							}),
					),
				],
			}),
		],
	});
	const children =
		room >= 648
			? [table, text('Text above the table')]
			: [text('Text above the table', (648 - room - 14) * 20), table];
	const document = new Document({
		title: `Wordcraft 0.15.0 picture row ${kind}`,
		subject: 'Public renderer regression fixture',
		styles: {
			default: {
				document: { run: { font: 'Times New Roman', size: 24 } },
			},
		},
		sections: [{ properties: { page: letterPage() }, children }],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}

/** A compact public matrix; it does not claim to reproduce every upstream loop case. */
export async function buildWordcraft0150TabFixture(
	outputDocx: string,
	font = 'Times New Roman',
	sizePt = 12,
): Promise<void> {
	const tabParagraph = (
		label: string,
		positionPt: number,
		leader?: typeof LeaderType.DOT | typeof LeaderType.NONE,
	) =>
		new Paragraph({
			indent: { left: 0, right: 0, firstLine: 0 },
			spacing: { before: 0, after: 0, line: 360, lineRule: 'exact' },
			tabStops: [
				{
					type: TabStopType.RIGHT,
					position: Math.round(positionPt * 20),
					leader,
				},
			],
			children: [
				new TextRun({
					children: [label, new Tab(), '12'],
					font,
					size: sizePt * 2,
				}),
			],
		});
	const document = new Document({
		title: 'Wordcraft 0.15.0 dot leader controls',
		subject: 'Public renderer regression fixture',
		sections: [
			{
				properties: { page: letterPage() },
				children: [
					...['E', 'Entr', 'Entry one', 'Entry number two'].flatMap(
						label =>
							[52, 288, 406.7].map(position =>
								tabParagraph(label, position, LeaderType.DOT),
							),
					),
					tabParagraph('Entry', 288, LeaderType.NONE),
					tabParagraph('Entry', 288),
				],
			},
		],
	});
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}
