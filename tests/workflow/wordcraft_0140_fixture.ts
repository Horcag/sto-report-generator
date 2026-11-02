import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
	AlignmentType,
	Document,
	Footer,
	Packer,
	Paragraph,
	SectionType,
	TextRun,
} from 'docx';
import { JSDOM } from 'jsdom';

import { getStoStyles, MARGINS, STO_NUMBERING } from '@/shared/config';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function writeFixture(
	outputDocx: string,
	document: Document,
): Promise<void> {
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	fs.writeFileSync(outputDocx, await Packer.toBuffer(document));
}

function paginationParagraph(
	text: string,
	widow: boolean,
	heading = false,
): Paragraph {
	return new Paragraph({
		alignment: AlignmentType.LEFT,
		indent: { left: 0, right: 0, firstLine: 0 },
		spacing: { before: 0, after: 0, line: 320, lineRule: 'exact' },
		keepNext: heading,
		keepLines: heading,
		widowControl: widow,
		children: text.split('\n').flatMap((line, index) => [
			new TextRun({
				text: line,
				font: 'Times New Roman',
				size: 28,
				break: index ? 1 : undefined,
			}),
		]),
	});
}

/** The caller calibrates the boundary on frozen old/new engines; no boundary is assumed here. */
export async function buildWordcraft0140PaginationFixture(
	outputDocx: string,
	fillerCount: number,
	widow = true,
	lines = 3,
	bodyHeightPt = 240,
): Promise<void> {
	if (!Number.isSafeInteger(fillerCount) || fillerCount < 0)
		throw new Error('fillerCount must be a nonnegative integer.');
	if (!Number.isSafeInteger(lines) || lines < 2 || lines > 4)
		throw new Error('lines must be 2, 3 or 4.');
	if (!Number.isSafeInteger(bodyHeightPt) || bodyHeightPt <= 0)
		throw new Error('bodyHeightPt must be a positive integer.');
	await writeFixture(
		outputDocx,
		new Document({
			title: 'Wordcraft 0.14.0 widow and keep controls',
			subject: 'Public renderer regression fixture',
			styles: getStoStyles('default'),
			numbering: STO_NUMBERING,
			sections: [
				{
					properties: {
						page: {
							size: {
								width: 7200,
								height: bodyHeightPt * 20 + 1440,
							},
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
						...Array.from({ length: fillerCount }, (_, index) =>
							paginationParagraph(`FILLER-${index + 1}`, false),
						),
						paginationParagraph('HEADING-KEEP', widow, true),
						paginationParagraph(
							['Bb', 'Bc', 'Bd', 'Be'].slice(0, lines).join('\n'),
							widow,
						),
					],
				},
			],
		}),
	);
}

/** Undefined Footer must inherit Normal rather than fall back to document defaults. */
export async function buildWordcraft0140UndefinedStyleFixture(
	outputDocx: string,
): Promise<void> {
	const styles = getStoStyles('default');
	const styleParagraph = (text: string, style: string, size?: number) =>
		new Paragraph({
			style,
			children: [
				new TextRun({ text, ...(size === undefined ? {} : { size }) }),
			],
		});
	const document = new Document({
		title: 'Wordcraft 0.14.0 undefined style controls',
		subject: 'Public renderer regression fixture',
		styles: {
			...styles,
			default: {
				...styles.default,
				document: {
					run: { font: 'Times New Roman', size: 24 },
					paragraph: { spacing: { after: 200 } },
				},
			},
			paragraphStyles: [
				...(styles.paragraphStyles ?? []).map(style =>
					style.id === 'Normal'
						? {
								...style,
								run: { font: 'Times New Roman', size: 26 },
								paragraph: {
									indent: { firstLine: 0 },
									spacing: {
										before: 20,
										after: 40,
										line: 259,
										lineRule: 'auto' as const,
									},
								},
							}
						: style,
				),
				{
					id: 'DefinedFooter9',
					name: 'Defined Footer 9 pt',
					basedOn: 'Normal',
					run: { font: 'Times New Roman', size: 18 },
				},
			],
		},
		numbering: STO_NUMBERING,
		sections: [
			['UNDEFINED-FOOTER', 'Footer', undefined],
			['DEFINED-FOOTER9', 'DefinedFooter9', undefined],
			['DIRECT-FOOTER16', 'Footer', 32],
		].map(([marker, style, size]) => ({
			properties: {
				type: SectionType.NEXT_PAGE,
				page: {
					size: { width: 11906, height: 16838 },
					margin: MARGINS,
				},
			},
			footers: {
				default: new Footer({
					children: [
						styleParagraph(
							`${marker}-STORY`,
							String(style),
							size as number | undefined,
						),
					],
				}),
			},
			children: [
				styleParagraph(
					`${marker}-BODY`,
					String(style),
					size as number | undefined,
				),
			],
		})),
	});
	const archive = new AdmZip(await Packer.toBuffer(document));
	const dom = new JSDOM(archive.readAsText('word/styles.xml'), {
		contentType: 'text/xml',
	});
	try {
		for (const style of [
			...dom.window.document.getElementsByTagNameNS(WORD, 'style'),
		])
			if (style.getAttributeNS(WORD, 'styleId') === 'Footer')
				style.remove();
		archive.updateFile('word/styles.xml', Buffer.from(dom.serialize()));
	} finally {
		dom.window.close();
	}
	fs.mkdirSync(path.dirname(path.resolve(outputDocx)), { recursive: true });
	archive.writeZip(outputDocx);
}
