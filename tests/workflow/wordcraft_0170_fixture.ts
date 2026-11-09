import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, ImageRun, Packer, Paragraph } from 'docx';

// Upstream controls: storytold/wordcraft 5574b32600aa7d782c64f5a6c6bb24696152220d.
// crates/doc/src/resolve.rs; crates/layout/src/tests.rs and tests/nested_cant_split.rs;
// crates/engine/src/cmd/references/tests.rs. Layout geometry uses explicit Arial.
const PAGE =
	'<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="0" w:footer="0" w:gutter="0"/>';
const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b w:val="false"/>';
const PICTURE = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSFgAAAHEASFiX4r9AAAAAElFTkSuQmCC',
	'base64',
);

function run(text: string, properties = '', size = 20): string {
	return `<w:r><w:rPr>${FONT}<w:sz w:val="${size}"/>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(
	content: string,
	properties = '',
	line = 240,
	rule = 'auto',
): string {
	return `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="${rule}"/><w:keepNext w:val="false"/><w:keepLines w:val="false"/><w:widowControl w:val="false"/>${properties}</w:pPr>${content}</w:p>`;
}

function section(type = ''): string {
	return `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}${PAGE}</w:sectPr>`;
}

/** Keep package relationships from docx, replacing only the controlled body XML. */
async function save(
	output: string,
	body: string | ((drawing: string) => string),
): Promise<void> {
	const document = new Document({
		styles: {
			default: {
				document: { run: { font: 'Arial', size: 20, bold: false } },
			},
			paragraphStyles: ['Normal', 'Other'].map(id => ({
				id,
				name: id,
				basedOn: id === 'Other' ? 'Normal' : undefined,
				run: { font: 'Arial', size: 20, bold: false },
			})),
		},
		sections: [
			{
				children: [
					new Paragraph({
						children: [
							new ImageRun({
								type: 'png',
								data: PICTURE,
								transformation: {
									width: (40 * 4) / 3,
									height: 8,
								},
							}),
						],
					}),
				],
			},
		],
	});
	const archive = new AdmZip(await Packer.toBuffer(document));
	let xml = archive.readAsText('word/document.xml');
	const drawing = xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/)?.[0];
	if (!drawing) throw new Error('Missing drawing in fixture template');
	xml = xml.replace(
		/<w:body>[\s\S]*?<\/w:body>/,
		`<w:body>${typeof body === 'function' ? body(drawing) : body}</w:body>`,
	);
	archive.updateFile('word/document.xml', Buffer.from(xml));
	fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
	archive.writeZip(output);
}

export const WORDCRAFT_0170_SCRIPT_SIZES = [
	8, 9, 10, 11, 12, 13, 14, 16, 20, 24, 36,
] as const;

/** Ordinary run scripts preserve the original size; renderer applies 0.65 scaling. */
export async function buildWordcraft0170ScriptFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		WORDCRAFT_0170_SCRIPT_SIZES.map(size =>
			paragraph(
				run(`${size}pt `, '', size * 2) +
					run('SUP', '<w:vertAlign w:val="superscript"/>', size * 2) +
					run(' baseline ', '', size * 2) +
					run('SUB', '<w:vertAlign w:val="subscript"/>', size * 2),
			),
		).join('') + section(),
	);
}

export const WORDCRAFT_0170_CONTEXTUAL_CASES = [
	{ id: 'normal-enabled', style: 'Normal', contextual: 'true' },
	{ id: 'normal-disabled', style: 'Normal', contextual: 'false' },
	{ id: 'other-enabled', style: 'Other', contextual: 'true' },
	{ id: 'normal-missing', style: 'Normal', contextual: null },
	{ id: 'undefined-style', style: 'Missing', contextual: 'true' },
] as const;

function table(content: string, cantSplit = false, width = 9360): string {
	return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit w:val="${cantSplit}"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
}

export async function buildWordcraft0170ContextualFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		WORDCRAFT_0170_CONTEXTUAL_CASES.map(
			item =>
				paragraph(run(item.id)) +
				table(
					paragraph(
						run('Alpha', '', 24),
						'<w:pStyle w:val="Normal"/>',
						480,
						'exact',
					) +
						paragraph(
							run('Beta', '', 24),
							`<w:pStyle w:val="${item.style}"/>${item.contextual === null ? '' : `<w:contextualSpacing w:val="${item.contextual}"/>`}`,
							480,
							'exact',
						).replace('w:after="0"', 'w:after="240"'),
				) +
				paragraph(
					run(`AFTER ${item.id}`, '', 24),
					'<w:pStyle w:val="Normal"/>',
					480,
					'exact',
				),
		).join('') + section(),
	);
}

export async function buildWordcraft0170ContinuousFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		paragraph(run('Cover')) +
			paragraph('', section('continuous')) +
			paragraph(run('Heading'), '<w:pageBreakBefore/>') +
			paragraph(run('Body')) +
			section('continuous'),
	);
}

export const WORDCRAFT_0170_PICTURE_CASES = [
	{ id: 'alone-single', mixed: false, line: 240, rule: 'auto' },
	{ id: 'mixed-single', mixed: true, line: 240, rule: 'auto' },
	{ id: 'alone-115', mixed: false, line: 276, rule: 'auto' },
	{ id: 'mixed-115', mixed: true, line: 276, rule: 'auto' },
	{ id: 'alone-150', mixed: false, line: 360, rule: 'auto' },
	{ id: 'mixed-150', mixed: true, line: 360, rule: 'auto' },
	{ id: 'alone-exact20', mixed: false, line: 400, rule: 'exact' },
	{ id: 'mixed-exact20', mixed: true, line: 400, rule: 'exact' },
] as const;

export async function buildWordcraft0170PictureFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		drawing =>
			WORDCRAFT_0170_PICTURE_CASES.map(
				(item, index) =>
					paragraph(run(`BEFORE ${item.id}`)) +
					paragraph(
						(item.mixed ? run('x') : '') +
							`<w:r><w:rPr>${FONT}<w:sz w:val="20"/><w:position w:val="-60"/></w:rPr>${drawing.replace(/(<wp:docPr\b[^>]*\bid=")[^"]*"/, `$1${index + 1}"`).replace(/(<wp:docPr\b[^>]*\bname=")[^"]*"/, `$1Picture ${index + 1}"`)}</w:r>`,
						'',
						item.line,
						item.rule,
					) +
					paragraph(run(`AFTER ${item.id}`)),
			).join('') + section(),
	);
}

export const WORDCRAFT_0170_SEQUENCE_CASES = [
	{
		instruction: 'SEQ Del',
		cached: '9',
		expected: '1',
		locked: false,
		deleted: false,
	},
	{
		instruction: 'SEQ Del',
		cached: '9',
		expected: '9',
		locked: false,
		deleted: true,
	},
	{
		instruction: 'SEQ Del',
		cached: '9',
		expected: '2',
		locked: false,
		deleted: false,
	},
	{
		instruction: 'SEQ Lock',
		cached: '9',
		expected: '1',
		locked: false,
		deleted: false,
	},
	{
		instruction: 'SEQ Lock',
		cached: '7',
		expected: '7',
		locked: true,
		deleted: false,
	},
	{
		instruction: 'SEQ Lock',
		cached: '9',
		expected: '3',
		locked: false,
		deleted: false,
	},
	{
		instruction: 'SEQ R \\r 5',
		cached: '7',
		expected: '7',
		locked: true,
		deleted: false,
	},
	{
		instruction: 'SEQ R',
		cached: '9',
		expected: '6',
		locked: false,
		deleted: false,
	},
] as const;

export async function buildWordcraft0170SequenceFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		WORDCRAFT_0170_SEQUENCE_CASES.map((item, index) => {
			const properties = `<w:rPr>${FONT}<w:sz w:val="20"/></w:rPr>`;
			const field = `<w:r>${properties}<w:fldChar w:fldCharType="begin"${item.locked ? ' w:fldLock="true"' : ''}/></w:r><w:r>${properties}<w:instrText xml:space="preserve"> ${item.instruction} </w:instrText></w:r><w:r>${properties}<w:fldChar w:fldCharType="separate"/></w:r>${run(item.cached)}<w:r>${properties}<w:fldChar w:fldCharType="end"/></w:r>`;
			return paragraph(
				run(`SEQ-${index + 1} `) +
					(item.deleted
						? `<w:del w:id="1" w:author="Fixture" w:date="2026-01-01T00:00:00Z">${field.replace('<w:t ', '<w:delText ').replace('</w:t>', '</w:delText>').replace('<w:instrText ', '<w:delInstrText ').replace('</w:instrText>', '</w:delInstrText>')}</w:del>`
						: field),
			);
		}).join('') + section(),
	);
}

export async function buildWordcraft0170NestedTableFixture(
	output: string,
): Promise<void> {
	await save(
		output,
		[true, false, true]
			.map(
				(cantSplit, index) =>
					paragraph(run(`CONTROL ${index}`), '', 10400, 'exact') +
					table(
						paragraph(run(`OUTER ${index}`)) +
							table(
								Array.from(
									{ length: index === 2 ? 60 : 20 },
									(_, row) =>
										paragraph(
											run(`NESTED ${index}-${row}`),
										),
								).join(''),
								cantSplit,
								4000,
							) +
							paragraph(run(`END ${index}`)),
						false,
						8800,
					) +
					paragraph(run(`AFTER ${index}`)) +
					(index < 2 ? paragraph('', section()) : ''),
			)
			.join('') + section(),
	);
}
