import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
	AlignmentType,
	Bookmark,
	Document,
	FootnoteReferenceRun,
	ImageRun,
	LevelFormat,
	Packer,
	Paragraph,
	SectionType,
	Tab,
	TabStopType,
	TextRun,
} from 'docx';

function page(left = 1440) {
	return {
		size: { width: 12240, height: 15840 },
		margin: {
			top: 1440,
			bottom: 1440,
			left,
			right: 1440,
			header: 0,
			footer: 0,
			gutter: 0,
		},
	};
}

function paragraph(text: string): Paragraph {
	return new Paragraph({
		indent: { left: 0, right: 0, firstLine: 0 },
		spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
		children: [new TextRun({ text, font: 'Arial', size: 20 })],
	});
}

async function save(output: string, document: Document): Promise<void> {
	fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
	fs.writeFileSync(output, await Packer.toBuffer(document));
}

/** Public controls adapted from pinned upstream references/tests.rs:556. */
export const WORDCRAFT_0160_FIELDS = [
	{ instruction: 'SEQ Figure \\* ARABIC', cached: '7', expected: '1' },
	{
		instruction: 'STYLEREF "FixtureHeading"',
		cached: 'stale style',
		expected: 'Chapter One',
	},
	{
		instruction: 'REF Mark \\h',
		cached: 'stale text',
		expected: 'Target words',
	},
	{ instruction: 'NUMWORDS', cached: '999', expected: '999' },
	{
		instruction: 'SEQ Table \\* ARABIC',
		cached: '9',
		expected: '9',
		locked: true,
	},
	{
		instruction: 'REF NumberedMark \\n \\h',
		cached: 'stale number n',
		expected: '(a)',
	},
	{
		instruction: 'REF NumberedMark \\r \\h',
		cached: 'stale number r',
		expected: '1.1(a)',
	},
	{
		instruction: 'REF NumberedMark \\w \\h',
		cached: 'stale number w',
		expected: '1.1(a)',
	},
] as const;

/** Stale field caches deliberately distinguish fresh export from saved XML. */
export async function buildWordcraft0160FieldFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		new Document({
			title: 'Wordcraft 0.16.0 fresh PDF fields',
			styles: {
				default: { document: { run: { font: 'Arial', size: 20 } } },
				paragraphStyles: [
					{
						id: 'FixtureHeading',
						name: 'FixtureHeading',
						basedOn: 'Normal',
						run: { font: 'Arial', size: 20, bold: false },
					},
				],
			},
			numbering: {
				config: [
					{
						reference: 'nested',
						levels: [
							{
								level: 0,
								format: LevelFormat.DECIMAL,
								text: '%1.',
								alignment: AlignmentType.LEFT,
							},
							{
								level: 1,
								format: LevelFormat.DECIMAL,
								text: '%1.%2',
								alignment: AlignmentType.LEFT,
							},
							{
								level: 2,
								format: LevelFormat.LOWER_LETTER,
								text: '(%3)',
								alignment: AlignmentType.LEFT,
							},
						],
					},
				],
			},
			sections: [
				{
					properties: { page: page() },
					children: [
						paragraph('Refs'),
						new Paragraph({
							style: 'FixtureHeading',
							children: [
								new TextRun({
									text: 'Chapter One',
									font: 'Arial',
									size: 20,
								}),
							],
						}),
						new Paragraph({
							children: [
								new Bookmark({
									id: 'Mark',
									children: [
										new TextRun({
											text: 'Target words',
											font: 'Arial',
											size: 20,
										}),
									],
								}),
							],
						}),
						...['First', 'Second'].map(
							(text, level) =>
								new Paragraph({
									numbering: { reference: 'nested', level },
									children: [
										new TextRun({
											text,
											font: 'Arial',
											size: 20,
										}),
									],
								}),
						),
						new Paragraph({
							numbering: { reference: 'nested', level: 2 },
							children: [
								new Bookmark({
									id: 'NumberedMark',
									children: [
										new TextRun({
											text: 'Numbered target',
											font: 'Arial',
											size: 20,
										}),
									],
								}),
							],
						}),
						...WORDCRAFT_0160_FIELDS.map((_, index) =>
							paragraph(`FIELD-${index}`),
						),
					],
				},
			],
		}),
	);
	const archive = new AdmZip(output);
	let xml = archive.readAsText('word/document.xml');
	for (const [index, field] of WORDCRAFT_0160_FIELDS.entries()) {
		const instruction = field.instruction
			.replaceAll('&', '&amp;')
			.replaceAll('"', '&quot;');
		const run = (body: string) =>
			`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>${body}</w:r>`;
		const fieldXml =
			run(
				`<w:fldChar w:fldCharType="begin"${'locked' in field ? ' w:fldLock="true"' : ''}/>`,
			) +
			run(
				`<w:instrText xml:space="preserve"> ${instruction} </w:instrText>`,
			) +
			run('<w:fldChar w:fldCharType="separate"/>') +
			run(`<w:t>${field.cached}</w:t>`) +
			run('<w:fldChar w:fldCharType="end"/>');
		xml = xml.replace(
			new RegExp(
				`<w:r>(?:(?!</w:r>)[\\s\\S])*<w:t[^>]*>FIELD-${index}</w:t></w:r>`,
			),
			fieldXml,
		);
	}
	archive.updateFile('word/document.xml', Buffer.from(xml));
	archive.writeZip(output);
}

export type Wordcraft0160SectionKind = 'nextPage' | 'evenPage' | 'oddPage';

/** #5291: the prior page's footnote retains its own section's 72 pt margin. */
export async function buildWordcraft0160FootnoteFixture(
	output: string,
	kind: Wordcraft0160SectionKind,
): Promise<void> {
	await save(
		output,
		new Document({
			title: `Wordcraft 0.16.0 section footnote ${kind}`,
			styles: {
				default: { document: { run: { font: 'Arial', size: 20 } } },
			},
			footnotes: { 1: { children: [paragraph('The note text.')] } },
			sections: [
				{
					properties: { page: page() },
					children: [
						new Paragraph({
							children: [
								new TextRun({
									text: 'Secti',
									font: 'Arial',
									size: 20,
								}),
								new FootnoteReferenceRun(1),
								new TextRun({
									text: 'on one text.',
									font: 'Arial',
									size: 20,
								}),
							],
						}),
					],
				},
				{
					properties: {
						type: {
							nextPage: SectionType.NEXT_PAGE,
							evenPage: SectionType.EVEN_PAGE,
							oddPage: SectionType.ODD_PAGE,
						}[kind],
						page: page(2880),
					},
					children: [paragraph('Two')],
				},
			],
		}),
	);
}

export const WORDCRAFT_0160_PICTURE_CASES = [
	{ id: 'empty-10-single', lead: '', size: 20, line: 240, position: 0 },
	{ id: 'spaces-10-single', lead: '    ', size: 20, line: 240, position: 0 },
	{ id: 'text-10-single', lead: 'x', size: 20, line: 240, position: 0 },
	{ id: 'empty-20-single', lead: '', size: 40, line: 240, position: 0 },
	{
		id: 'empty-10-115-lowered',
		lead: '',
		size: 20,
		line: 276,
		position: -20,
	},
	{
		id: 'empty-10-150-lowered',
		lead: '',
		size: 20,
		line: 360,
		position: -60,
	},
	{
		id: 'empty-10-single-raised',
		lead: '',
		size: 20,
		line: 240,
		position: 20,
	},
] as const;

const PICTURE = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSFgAAAHEASFiX4r9AAAAAElFTkSuQmCC',
	'base64',
);

/** #5763: markers stay outside the image line to preserve picture-only geometry. */
export async function buildWordcraft0160PictureFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		new Document({
			title: 'Wordcraft 0.16.0 picture-only line height',
			styles: {
				default: { document: { run: { font: 'Arial', size: 20 } } },
			},
			sections: [
				{
					properties: { page: page() },
					children: WORDCRAFT_0160_PICTURE_CASES.flatMap(item => [
						paragraph(`BEFORE ${item.id}`),
						new Paragraph({
							run: { font: 'Arial', size: item.size },
							indent: { left: 0, right: 0, firstLine: 0 },
							spacing: {
								before: 0,
								after: 0,
								line: item.line,
								lineRule: 'auto',
							},
							children: [
								...(item.lead
									? [
											new TextRun({
												text: item.lead,
												font: 'Arial',
												size: item.size,
											}),
										]
									: []),
								new ImageRun({
									type: 'png',
									data: PICTURE,
									transformation: {
										width: (40 * 4) / 3,
										height: (30 * 4) / 3,
									},
									run: {
										font: 'Arial',
										size: item.size,
										position: `${item.position / 2}pt`,
									},
								}),
							],
						}),
						paragraph(`AFTER ${item.id}`),
					]),
				},
			],
		}),
	);
	const archive = new AdmZip(output);
	const xml = archive
		.readAsText('word/document.xml')
		.replace(
			/<w:position w:val="(-?[0-9.]+)pt"\/>/g,
			(_, points: string) =>
				`<w:position w:val="${Number(points) * 2}"/>`,
		);
	archive.updateFile('word/document.xml', Buffer.from(xml));
	archive.writeZip(output);
}

/** #5715: ordinary text tabs under paragraph alignment, without positional tabs. */
export async function buildWordcraft0160TabFixture(
	output: string,
): Promise<void> {
	const configurations = [
		[{ type: TabStopType.LEFT, position: 3600 }],
		[{ type: TabStopType.CENTER, position: 4680 }],
		[
			{ type: TabStopType.CENTER, position: 4680 },
			{ type: TabStopType.RIGHT, position: 7290 },
		],
		[
			{ type: TabStopType.CENTER, position: 4680 },
			{ type: TabStopType.RIGHT, position: 9360 },
		],
	];
	await save(
		output,
		new Document({
			title: 'Wordcraft 0.16.0 ordinary tabs',
			styles: {
				default: { document: { run: { font: 'Arial', size: 20 } } },
			},
			sections: [
				{
					properties: { page: page() },
					children: [
						AlignmentType.LEFT,
						AlignmentType.CENTER,
						AlignmentType.RIGHT,
					].flatMap(alignment =>
						configurations.map(
							tabStops =>
								new Paragraph({
									alignment,
									indent: { left: 0, right: 0, firstLine: 0 },
									spacing: {
										before: 0,
										after: 0,
										line: 360,
										lineRule: 'exact',
									},
									tabStops,
									children: [
										new TextRun({
											font: 'Arial',
											size: 20,
											children: [
												'Label',
												new Tab(),
												'filename',
												...(tabStops.length === 2
													? [new Tab(), 'time']
													: []),
											],
										}),
									],
								}),
						),
					),
				},
			],
		}),
	);
}
