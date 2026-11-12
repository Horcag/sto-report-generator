import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph } from 'docx';

// Primary controls at storytold/wordcraft 079f478bd85df7bcc567e3bafa7d7219096f9c3c:
// https://github.com/storytold/wordcraft/pull/6033 (tracked equations)
// https://github.com/storytold/wordcraft/pull/5849 (protected field updates)
// https://github.com/storytold/wordcraft/pull/6049 (column numbers/localised style).
const PAGE =
	'<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="0" w:footer="0" w:gutter="0"/>';
const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>';
const run = (text: string) =>
	`<w:r><w:rPr>${FONT}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, properties = '') =>
	`<w:p><w:pPr>${properties}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>${content}</w:p>`;
const section = (properties = '') =>
	`<w:sectPr>${PAGE}${properties}</w:sectPr>`;

/** Preserve the docx-js package; inject only the controlled body/settings/styles. */
async function save(
	output: string,
	body: string,
	settings = '',
	styles = '',
): Promise<void> {
	const document = new Document({
		title: 'Wordcraft 0.18.1 controls',
		subject: 'Public renderer regression fixture',
		styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
		sections: [{ children: [new Paragraph('Template')] }],
	});
	const archive = new AdmZip(await Packer.toBuffer(document));
	const xml = archive.readAsText('word/document.xml');
	archive.updateFile(
		'word/document.xml',
		Buffer.from(
			xml.replace(
				/<w:body>[\s\S]*?<\/w:body>/,
				`<w:body>${body}</w:body>`,
			),
		),
	);
	if (settings) {
		const settingsXml = archive.readAsText('word/settings.xml');
		archive.updateFile(
			'word/settings.xml',
			Buffer.from(
				settingsXml.replace(
					'<w:defaultTabStop',
					`${settings}<w:defaultTabStop`,
				),
			),
		);
	}
	if (styles) {
		const stylesXml = archive
			.readAsText('word/styles.xml')
			.replace(
				/<w:style\b[^>]*w:styleId="LineNumber"[^>]*>[\s\S]*?<\/w:style>/g,
				'',
			);
		archive.updateFile(
			'word/styles.xml',
			Buffer.from(
				stylesXml.replace('</w:styles>', `${styles}</w:styles>`),
			),
		);
	}
	fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
	archive.writeZip(output);
}

export const WORDCRAFT_0181_MATH_CASES = [
	{
		id: 'inline-insert',
		revision: 'ins',
		display: false,
		nested: false,
		text: 'x+1',
	},
	{
		id: 'inline-delete',
		revision: 'del',
		display: false,
		nested: false,
		text: 'y-1',
	},
	{
		id: 'inline-plain',
		revision: null,
		display: false,
		nested: false,
		text: 'z=1',
	},
	{
		id: 'display-insert',
		revision: 'ins',
		display: true,
		nested: false,
		text: 'a+b',
	},
	{
		id: 'display-delete',
		revision: 'del',
		display: true,
		nested: false,
		text: 'c-d',
	},
	{
		id: 'display-plain',
		revision: null,
		display: true,
		nested: false,
		text: 'e=f',
	},
	{
		id: 'nested-insert',
		revision: 'ins',
		display: true,
		nested: true,
		text: 'g+1',
	},
	{
		id: 'nested-delete',
		revision: 'del',
		display: true,
		nested: true,
		text: 'h-1',
	},
] as const;

/** Default uses outer wrappers. Opt-in nested inputs are defensive parser controls, not Word acceptance. */
export async function buildWordcraft0181MathFixture(
	output: string,
	includeDefensiveNested = false,
): Promise<void> {
	const body = WORDCRAFT_0181_MATH_CASES.filter(
		item => includeDefensiveNested || !item.nested,
	)
		.map((item, index) => {
			const math = `<m:oMath><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:sz w:val="24"/></w:rPr><m:t>${item.text}</m:t></m:r></m:oMath>`;
			const revise = (content: string) =>
				item.revision
					? `<w:${item.revision} w:id="${index + 1}" w:author="Fixture" w:date="2026-01-01T00:00:00Z">${content}</w:${item.revision}>`
					: content;
			const display = (content: string) =>
				`<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${content}</m:oMathPara>`;
			return paragraph(
				run(`${item.id} `) +
					(item.nested
						? display(revise(math))
						: revise(item.display ? display(math) : math)),
			);
		})
		.join('');
	await save(output, body + section(), '<w:trackRevisions/>');
}

export type Wordcraft0181Protection = 'readOnly' | 'forms' | 'comments' | null;

/** Cached 104 must remain when protection blocks updates; null is the update control. */
export async function buildWordcraft0181ProtectedFieldFixture(
	output: string,
	protection: Wordcraft0181Protection = 'readOnly',
): Promise<void> {
	const field = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF target </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('104')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
	await save(
		output,
		paragraph(run('Contents ') + field) +
			paragraph(
				'<w:bookmarkStart w:id="1" w:name="target"/>' +
					run('Target') +
					'<w:bookmarkEnd w:id="1"/>',
				'<w:pageBreakBefore/>',
			) +
			section(),
		protection
			? `<w:documentProtection w:edit="${protection}" w:enforcement="1"/>`
			: '',
	);
}

/** Explicit column break guarantees both columns are exercised without font-dependent overflow. */
export async function buildWordcraft0181LineNumberFixture(
	output: string,
	localized = true,
): Promise<void> {
	const body = Array.from({ length: 72 }, (_, index) =>
		paragraph(
			(index === 36 ? '<w:r><w:br w:type="column"/></w:r>' : '') +
				run(
					`COLUMN-${index < 36 ? 1 : 2} LINE-${String(index + 1).padStart(2, '0')}`,
				),
		),
	).join('');
	const style = `<w:style w:type="character" w:styleId="${localized ? 'Zeilennummer' : 'LineNumber'}"><w:name w:val="Line Number"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="C00000"/><w:sz w:val="16"/></w:rPr></w:style>`;
	await save(
		output,
		body +
			section(
				'<w:lnNumType w:countBy="1" w:start="1" w:distance="360" w:restart="continuous"/><w:cols w:num="2" w:space="720"/>',
			),
		'',
		style,
	);
}
