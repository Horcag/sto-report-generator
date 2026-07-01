import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const DOCUMENT_XML_PATH = 'word/document.xml';
const SETTINGS_XML_PATH = 'word/settings.xml';
const RELATIONSHIP_REFERENCE_PATTERN = /\s+r:(?:id|embed|link)="[^"]+"/;
const PAGE_BREAK_PARAGRAPH = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const FRONT_MATTER_PARAGRAPH_DEFAULTS =
	'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/>';
const FRONT_MATTER_RUN_FONTS =
	'<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';

interface DocumentBodyParts {
	beforeBody: string;
	bodyOpen: string;
	bodyContent: string;
	sectPr: string;
	afterBody: string;
}

export function clearDirtyFieldFlags(docxBuffer: Buffer): Buffer {
	const archive = new AdmZip(docxBuffer);
	const documentXml = archive.getEntry(DOCUMENT_XML_PATH);
	if (!documentXml) {
		return docxBuffer;
	}

	const cleanedXml = documentXml
		.getData()
		.toString('utf8')
		.replace(/\s+w:dirty="(?:true|1)"/g, '');
	archive.updateFile(DOCUMENT_XML_PATH, Buffer.from(cleanedXml, 'utf8'));
	return archive.toBuffer();
}

export function unpackDocx(docxPath: string, targetDir: string): void {
	fs.rmSync(targetDir, { recursive: true, force: true });
	fs.mkdirSync(targetDir, { recursive: true });
	new AdmZip(docxPath).extractAllTo(targetDir, true);
}

export function readDocxEntry(docxPath: string, entryPath: string): string {
	const entry = new AdmZip(docxPath).getEntry(entryPath);
	if (!entry) {
		throw new Error(`${entryPath} not found in ${path.basename(docxPath)}`);
	}
	return entry.getData().toString('utf8');
}

function readArchiveEntry(
	archive: AdmZip,
	entryPath: string,
	docxPath: string,
): string {
	const entry = archive.getEntry(entryPath);
	if (!entry) {
		throw new Error(`${entryPath} not found in ${path.basename(docxPath)}`);
	}
	return entry.getData().toString('utf8');
}

function readOptionalArchiveEntry(
	archive: AdmZip,
	entryPath: string,
): string | null {
	const entry = archive.getEntry(entryPath);
	return entry ? entry.getData().toString('utf8') : null;
}

function splitDocumentBody(
	documentXml: string,
	docxPath: string,
): DocumentBodyParts {
	const bodyOpenMatch = /<w:body\b[^>]*>/.exec(documentXml);
	const bodyCloseIndex = documentXml.lastIndexOf('</w:body>');
	if (!bodyOpenMatch || bodyCloseIndex < 0) {
		throw new Error(
			`word/document.xml in ${path.basename(docxPath)} has no w:body.`,
		);
	}

	const bodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
	const rawBodyContent = documentXml.slice(bodyStart, bodyCloseIndex);
	const sectPrMatch = rawBodyContent.match(
		/\s*(<w:sectPr\b[\s\S]*<\/w:sectPr>)\s*$/,
	);

	return {
		beforeBody: documentXml.slice(0, bodyOpenMatch.index),
		bodyOpen: bodyOpenMatch[0],
		bodyContent: sectPrMatch
			? rawBodyContent.slice(0, sectPrMatch.index)
			: rawBodyContent,
		sectPr: sectPrMatch?.[1] ?? '',
		afterBody: documentXml.slice(bodyCloseIndex),
	};
}

function splitTopLevelWordElements(xml: string): string[] {
	const elements: string[] = [];
	let index = 0;

	while (index < xml.length) {
		const startOffset = xml
			.slice(index)
			.search(/<w:[A-Za-z0-9]+(?:\s|>|\/)/);
		if (startOffset === -1) {
			break;
		}

		const start = index + startOffset;
		const openingMatch = /^<w:([A-Za-z0-9]+)(?:\s[^>]*)?\/?>/.exec(
			xml.slice(start),
		);
		if (!openingMatch) {
			index = start + 1;
			continue;
		}

		const tagName = openingMatch[1];
		const openingTag = openingMatch[0];
		if (openingTag.endsWith('/>')) {
			elements.push(openingTag);
			index = start + openingTag.length;
			continue;
		}

		const tagPattern = new RegExp(`<\\/?w:${tagName}(?:\\s[^>]*)?>`, 'g');
		tagPattern.lastIndex = start;
		let depth = 0;
		let end = -1;
		let match: RegExpExecArray | null;

		while ((match = tagPattern.exec(xml))) {
			const token = match[0];
			if (token.startsWith('</')) {
				depth -= 1;
			} else if (!token.endsWith('/>')) {
				depth += 1;
			}

			if (depth === 0) {
				end = tagPattern.lastIndex;
				break;
			}
		}

		if (end < 0) {
			throw new Error(`Cannot parse top-level w:${tagName} element.`);
		}

		elements.push(xml.slice(start, end));
		index = end;
	}

	return elements;
}

function getWordText(xml: string): string {
	return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(match => match[1])
		.join('')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function findInsertIndex(elements: string[], beforeText: string): number {
	const normalizedNeedle = beforeText.trim().toLocaleUpperCase('ru-RU');
	const index = elements.findIndex(element =>
		getWordText(element)
			.trim()
			.toLocaleUpperCase('ru-RU')
			.includes(normalizedNeedle),
	);
	if (index < 0) {
		throw new Error(
			`Cannot find insertion marker "${beforeText}" in target DOCX.`,
		);
	}
	return index;
}

function getDocxBodyElements(archive: AdmZip, docxPath: string): string[] {
	const documentXml = readArchiveEntry(archive, DOCUMENT_XML_PATH, docxPath);
	const bodyParts = splitDocumentBody(documentXml, docxPath);
	return splitTopLevelWordElements(bodyParts.bodyContent);
}

function ensureParagraphProperty(
	paragraphPropertiesXml: string,
	tagName: string,
	tagXml: string,
): string {
	if (new RegExp(`<w:${tagName}\\b`).test(paragraphPropertiesXml)) {
		return paragraphPropertiesXml;
	}
	return paragraphPropertiesXml.replace('</w:pPr>', `${tagXml}</w:pPr>`);
}

function ensureTagAttributes(
	xml: string,
	tagName: string,
	attributes: Record<string, string>,
): string {
	return xml.replace(
		new RegExp(`<w:${tagName}\\b([^>]*)\\/?>`),
		(tagXml: string) => {
			let updatedTagXml = tagXml;
			for (const [name, value] of Object.entries(attributes)) {
				if (!new RegExp(`\\s${name}=`).test(updatedTagXml)) {
					updatedTagXml = updatedTagXml.replace(
						/\/?>$/,
						` ${name}="${value}"$&`,
					);
				}
			}
			return updatedTagXml;
		},
	);
}

function ensureEmptyTagAttributes(
	tagXml: string,
	attributes: Record<string, string>,
): string {
	let updatedTagXml = tagXml;
	for (const [name, value] of Object.entries(attributes)) {
		if (!new RegExp(`\\s${name}=`).test(updatedTagXml)) {
			updatedTagXml = updatedTagXml.replace(
				/\/?>/,
				` ${name}="${value}"$&`,
			);
		}
	}
	return updatedTagXml;
}

function ensureRunProperty(
	runPropertiesXml: string,
	tagName: string,
	tagXml: string,
): string {
	if (new RegExp(`<w:${tagName}\\b`).test(runPropertiesXml)) {
		return runPropertiesXml;
	}
	return runPropertiesXml.replace('</w:rPr>', `${tagXml}</w:rPr>`);
}

function createFrontMatterRunDefaults(fontSizeHalfPoints: string): string {
	return `${FRONT_MATTER_RUN_FONTS}<w:sz w:val="${fontSizeHalfPoints}"/><w:szCs w:val="${fontSizeHalfPoints}"/>`;
}

function normalizeFrontMatterRun(
	runXml: string,
	fontSizeHalfPoints: string,
): string {
	const runDefaults = createFrontMatterRunDefaults(fontSizeHalfPoints);
	const propertiesMatch = /<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/.exec(
		runXml,
	);
	if (!propertiesMatch) {
		return runXml.replace(
			/(<w:r\b[^>]*>)/,
			`$1<w:rPr>${runDefaults}</w:rPr>`,
		);
	}

	let propertiesXml = propertiesMatch[0];
	if (propertiesXml.endsWith('/>')) {
		propertiesXml = propertiesXml.replace(
			/\/>$/,
			`>${runDefaults}</w:rPr>`,
		);
	}
	propertiesXml = ensureRunProperty(
		propertiesXml,
		'rFonts',
		FRONT_MATTER_RUN_FONTS,
	);
	propertiesXml = ensureRunProperty(
		propertiesXml,
		'sz',
		`<w:sz w:val="${fontSizeHalfPoints}"/>`,
	);
	propertiesXml = ensureRunProperty(
		propertiesXml,
		'szCs',
		`<w:szCs w:val="${fontSizeHalfPoints}"/>`,
	);

	return (
		runXml.slice(0, propertiesMatch.index) +
		propertiesXml +
		runXml.slice(propertiesMatch.index + propertiesMatch[0].length)
	);
}

function ensureFrontMatterParagraphMarkRunProperties(
	paragraphPropertiesXml: string,
	fontSizeHalfPoints: string,
): string {
	const propertiesMatch = /<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/.exec(
		paragraphPropertiesXml,
	);
	if (!propertiesMatch) {
		return paragraphPropertiesXml.replace(
			'</w:pPr>',
			`<w:rPr>${createFrontMatterRunDefaults(fontSizeHalfPoints)}</w:rPr></w:pPr>`,
		);
	}

	let runPropertiesXml = propertiesMatch[0];
	if (runPropertiesXml.endsWith('/>')) {
		runPropertiesXml = runPropertiesXml.replace(/\/>$/, '></w:rPr>');
	}
	runPropertiesXml = ensureRunProperty(
		runPropertiesXml,
		'rFonts',
		FRONT_MATTER_RUN_FONTS,
	);
	runPropertiesXml = ensureRunProperty(
		runPropertiesXml,
		'sz',
		`<w:sz w:val="${fontSizeHalfPoints}"/>`,
	);
	runPropertiesXml = ensureRunProperty(
		runPropertiesXml,
		'szCs',
		`<w:szCs w:val="${fontSizeHalfPoints}"/>`,
	);

	return (
		paragraphPropertiesXml.slice(0, propertiesMatch.index) +
		runPropertiesXml +
		paragraphPropertiesXml.slice(
			propertiesMatch.index + propertiesMatch[0].length,
		)
	);
}

function normalizeFrontMatterParagraph(
	paragraphXml: string,
	fontSizeHalfPoints = '24',
): string {
	if (/^<w:p\b[^>]*\/>$/.test(paragraphXml.trim())) {
		return paragraphXml.replace(
			/\/>$/,
			`><w:pPr>${FRONT_MATTER_PARAGRAPH_DEFAULTS}<w:rPr>${createFrontMatterRunDefaults(fontSizeHalfPoints)}</w:rPr></w:pPr></w:p>`,
		);
	}

	const propertiesMatch = /<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/.exec(
		paragraphXml,
	);
	if (!propertiesMatch) {
		const updatedParagraphXml = paragraphXml.replace(
			/(<w:p\b[^>]*>)/,
			`$1<w:pPr>${FRONT_MATTER_PARAGRAPH_DEFAULTS}<w:rPr>${createFrontMatterRunDefaults(fontSizeHalfPoints)}</w:rPr></w:pPr>`,
		);
		return updatedParagraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, runXml =>
			normalizeFrontMatterRun(runXml, fontSizeHalfPoints),
		);
	}

	let propertiesXml = propertiesMatch[0];
	if (propertiesXml.endsWith('/>')) {
		propertiesXml = propertiesXml.replace(/\/>$/, '></w:pPr>');
	}
	propertiesXml = ensureParagraphProperty(
		propertiesXml,
		'spacing',
		'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>',
	);
	propertiesXml = ensureParagraphProperty(
		propertiesXml,
		'ind',
		'<w:ind w:left="0" w:firstLine="0"/>',
	);
	propertiesXml = ensureParagraphProperty(
		propertiesXml,
		'jc',
		'<w:jc w:val="left"/>',
	);
	propertiesXml = ensureTagAttributes(propertiesXml, 'spacing', {
		'w:before': '0',
		'w:after': '0',
		'w:line': '240',
		'w:lineRule': 'auto',
	});
	propertiesXml = ensureTagAttributes(propertiesXml, 'ind', {
		'w:left': '0',
		'w:firstLine': '0',
	});
	propertiesXml = ensureFrontMatterParagraphMarkRunProperties(
		propertiesXml,
		fontSizeHalfPoints,
	);

	const updatedParagraphXml =
		paragraphXml.slice(0, propertiesMatch.index) +
		propertiesXml +
		paragraphXml.slice(propertiesMatch.index + propertiesMatch[0].length);

	return updatedParagraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, runXml =>
		normalizeFrontMatterRun(runXml, fontSizeHalfPoints),
	);
}

function getTopLevelTableRows(tableXml: string): string[] {
	return tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
}

function getRowCells(rowXml: string): string[] {
	return rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
}

function assignmentSignatureNameByRow(
	rows: string[],
	rowIndex: number,
	fallback: string,
): string {
	const cells = getRowCells(rows[rowIndex] ?? '');
	const text = getWordText(cells[2] ?? '').trim();
	return text || fallback;
}

function assignmentGroupNumber(tableXml: string): string {
	return (
		/группы\s*№\s*([0-9A-Za-zА-Яа-яЁё-]+)/i.exec(
			getWordText(tableXml),
		)?.[1] ?? '6302-010302D'
	);
}

function canonicalFrontMatterParagraphXml(
	text: string,
	options: {
		alignment?: 'left' | 'center';
		italics?: boolean;
		size?: string;
	} = {},
): string {
	const alignment = options.alignment ?? 'left';
	const size = options.size ?? '24';
	const italicXml = options.italics ? '<w:i/><w:iCs/>' : '';
	const alignmentXml = `<w:jc w:val="${alignment}"/>`;
	return [
		'<w:p>',
		'<w:pPr>',
		'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>',
		'<w:ind w:left="0" w:firstLine="0"/>',
		alignmentXml,
		'</w:pPr>',
		'<w:r>',
		`<w:rPr>${FRONT_MATTER_RUN_FONTS}${italicXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
		`<w:t>${escapeXml(text)}</w:t>`,
		'</w:r>',
		'</w:p>',
	].join('');
}

function canonicalFrontMatterCellXml(
	paragraphs: string[],
	options: { verticalAlign?: 'center' | 'bottom'; widthDxa?: string } = {},
): string {
	const widthXml =
		options.widthDxa !== undefined
			? `<w:tcW w:w="${options.widthDxa}" w:type="dxa"/>`
			: '';
	return [
		'<w:tc>',
		`<w:tcPr>${widthXml}<w:vAlign w:val="${options.verticalAlign ?? 'center'}"/></w:tcPr>`,
		...paragraphs,
		'</w:tc>',
	].join('');
}

function canonicalSignatureLineCellXml(): string {
	return canonicalFrontMatterCellXml(
		[
			canonicalFrontMatterParagraphXml('______________________', {
				alignment: 'center',
			}),
			canonicalFrontMatterParagraphXml('(подпись)', {
				alignment: 'center',
				italics: true,
				size: '16',
			}),
		],
		{ widthDxa: '2916' },
	);
}

function canonicalFrontMatterSignatureRowXml(
	labelLines: string[],
	name: string,
): string {
	return [
		'<w:tr>',
		'<w:trPr><w:trHeight w:val="980" w:hRule="atLeast"/></w:trPr>',
		canonicalFrontMatterCellXml(
			labelLines.map(line => canonicalFrontMatterParagraphXml(line)),
			{ widthDxa: '4263' },
		),
		canonicalSignatureLineCellXml(),
		canonicalFrontMatterCellXml([canonicalFrontMatterParagraphXml(name)], {
			widthDxa: '1675',
		}),
		'</w:tr>',
	].join('');
}

function normalizeAssignmentSignatureTable(
	tableXml: string,
): string | undefined {
	if (!getWordText(tableXml).includes('Задание принял к исполнению')) {
		return undefined;
	}

	const rows = getTopLevelTableRows(tableXml);
	const universitySupervisorName = assignmentSignatureNameByRow(
		rows,
		0,
		'Л.В. Логанова',
	);
	const organizationSupervisorName = assignmentSignatureNameByRow(
		rows,
		1,
		'Г.Н. Дунаев',
	);
	const studentName = assignmentSignatureNameByRow(rows, 2, 'Н.С. Лебедев');
	const groupNumber = assignmentGroupNumber(tableXml);

	return [
		'<w:tbl>',
		'<w:tblPr>',
		'<w:tblW w:w="8854" w:type="dxa"/>',
		'<w:jc w:val="left"/>',
		'<w:tblBorders>',
		'<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>',
		'</w:tblBorders>',
		'<w:tblLayout w:type="fixed"/>',
		'<w:tblLook w:val="0400"/>',
		'</w:tblPr>',
		'<w:tblGrid><w:gridCol w:w="4263"/><w:gridCol w:w="2916"/><w:gridCol w:w="1675"/></w:tblGrid>',
		canonicalFrontMatterSignatureRowXml(
			[
				'Руководитель практики',
				'от университета, доцент кафедры',
				'технической кибернетики, к.т.н.',
			],
			universitySupervisorName,
		),
		canonicalFrontMatterSignatureRowXml(
			[
				'Руководитель практики',
				'от ВСО СК России по Самарскому',
				'гарнизону, руководитель отдела',
			],
			organizationSupervisorName,
		),
		canonicalFrontMatterSignatureRowXml(
			[
				'Задание принял к исполнению',
				`обучающийся группы № ${groupNumber}`,
			],
			studentName,
		),
		'</w:tbl>',
	].join('');
}

function isAssignmentPlanTable(tableXml: string): boolean {
	return getWordText(tableXml).includes('Планируемые результаты');
}

function getTableGridWidthDxa(tableXml: string): string | undefined {
	const gridMatch = /<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/.exec(tableXml);
	if (!gridMatch) {
		return undefined;
	}

	const widths = [
		...gridMatch[0].matchAll(/<w:gridCol\b[^>]*\sw:w="([^"]+)"/g),
	]
		.map(match => Number.parseFloat(match[1]))
		.filter(width => Number.isFinite(width));
	if (widths.length === 0) {
		return undefined;
	}

	return String(Math.round(widths.reduce((sum, width) => sum + width, 0)));
}

function normalizeFrontMatterTableProperties(tableXml: string): string {
	const tableWidthDxa = getTableGridWidthDxa(tableXml);
	const tableWidthXml = tableWidthDxa
		? `<w:tblW w:w="${tableWidthDxa}" w:type="dxa"/>`
		: undefined;
	const tablePropertiesMatch = /<w:tblPr\b[\s\S]*?<\/w:tblPr>/.exec(tableXml);
	if (!tablePropertiesMatch) {
		if (!tableWidthXml) {
			return tableXml;
		}
		return tableXml.replace(
			/(<w:tbl\b[^>]*>)/,
			`$1<w:tblPr>${tableWidthXml}</w:tblPr>`,
		);
	}

	let tablePropertiesXml = tablePropertiesMatch[0].replace(
		/<w:tblCellMar\b[\s\S]*?<\/w:tblCellMar>|<w:tblCellMar\b[^>]*\/>/g,
		'',
	);
	if (tableWidthXml && /<w:tblW\b/.test(tablePropertiesXml)) {
		tablePropertiesXml = tablePropertiesXml.replace(
			/<w:tblW\b[\s\S]*?<\/w:tblW>|<w:tblW\b[^>]*\/>/,
			tableWidthXml,
		);
	} else if (tableWidthXml) {
		tablePropertiesXml = tablePropertiesXml.replace(
			/(<w:tblPr\b[^>]*>)/,
			`$1${tableWidthXml}`,
		);
	}

	return (
		tableXml.slice(0, tablePropertiesMatch.index) +
		tablePropertiesXml +
		tableXml.slice(
			tablePropertiesMatch.index + tablePropertiesMatch[0].length,
		)
	);
}

function normalizeFrontMatterTableGeometry(tableXml: string): string {
	return normalizeFrontMatterTableProperties(tableXml)
		.replace(/<w:tcW\b[^>]*(?:\/>|>[\s\S]*?<\/w:tcW>)/g, '')
		.replace(/<w:trHeight\b[^>]*(?:\/>|><\/w:trHeight>)/g, tagXml =>
			ensureEmptyTagAttributes(tagXml, {
				'w:hRule': 'atLeast',
			}),
		);
}

function normalizeFrontMatterElement(elementXml: string): string {
	if (elementXml.startsWith('<w:p')) {
		return normalizeFrontMatterParagraph(elementXml);
	}
	if (elementXml.startsWith('<w:tbl')) {
		const signatureTableXml = normalizeAssignmentSignatureTable(elementXml);
		if (signatureTableXml) {
			return signatureTableXml;
		}
		if (isAssignmentPlanTable(elementXml)) {
			return elementXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraphXml =>
				normalizeFrontMatterParagraph(paragraphXml, '24'),
			);
		}
		return normalizeFrontMatterTableGeometry(elementXml).replace(
			/<w:p\b[\s\S]*?<\/w:p>/g,
			paragraphXml => normalizeFrontMatterParagraph(paragraphXml, '20'),
		);
	}
	return elementXml;
}

function copyFrontMatterSettings(
	targetArchive: AdmZip,
	sourceArchive: AdmZip,
): void {
	const sourceSettingsXml = readOptionalArchiveEntry(
		sourceArchive,
		SETTINGS_XML_PATH,
	);
	const targetSettingsXml = readOptionalArchiveEntry(
		targetArchive,
		SETTINGS_XML_PATH,
	);
	if (sourceSettingsXml === null || targetSettingsXml === null) {
		return;
	}

	let updatedSettingsXml = targetSettingsXml;
	const sourceDefaultTabStop =
		/<w:defaultTabStop\b[^>]*\bw:val="([^"]+)"/.exec(
			sourceSettingsXml,
		)?.[1] ?? null;
	if (sourceDefaultTabStop !== null) {
		updatedSettingsXml = updatedSettingsXml.replace(
			/<w:defaultTabStop\b[^>]*\/>/,
			`<w:defaultTabStop w:val="${sourceDefaultTabStop}"/>`,
		);
	}

	if (
		sourceSettingsXml.includes('<w:autoHyphenation') &&
		!updatedSettingsXml.includes('<w:autoHyphenation')
	) {
		updatedSettingsXml = updatedSettingsXml.replace(
			/(<w:defaultTabStop\b[^>]*\/>)/,
			'$1<w:autoHyphenation/>',
		);
	}
	const bottomHyphenationSettingName = 'useWord2013TrackBottomHyphenation';
	const sourceBottomHyphenationSetting = new RegExp(
		`<w:compatSetting\\b(?=[^>]*\\bw:name="${bottomHyphenationSettingName}")[^>]*/>`,
	).exec(sourceSettingsXml)?.[0];
	if (sourceBottomHyphenationSetting) {
		const targetBottomHyphenationPattern = new RegExp(
			`<w:compatSetting\\b(?=[^>]*\\bw:name="${bottomHyphenationSettingName}")[^>]*/>`,
		);
		if (targetBottomHyphenationPattern.test(updatedSettingsXml)) {
			updatedSettingsXml = updatedSettingsXml.replace(
				targetBottomHyphenationPattern,
				sourceBottomHyphenationSetting,
			);
		} else if (updatedSettingsXml.includes('</w:compat>')) {
			updatedSettingsXml = updatedSettingsXml.replace(
				'</w:compat>',
				`${sourceBottomHyphenationSetting}</w:compat>`,
			);
		}
	}

	if (updatedSettingsXml !== targetSettingsXml) {
		targetArchive.updateFile(
			SETTINGS_XML_PATH,
			Buffer.from(updatedSettingsXml, 'utf8'),
		);
	}
}

export function insertDocxBodyBeforeText(options: {
	targetDocxPath: string;
	sourceDocxPath: string;
	beforeText: string;
	addPageBreakBefore?: boolean;
}): void {
	const targetArchive = new AdmZip(options.targetDocxPath);
	const sourceArchive = new AdmZip(options.sourceDocxPath);
	const targetDocumentXml = readArchiveEntry(
		targetArchive,
		DOCUMENT_XML_PATH,
		options.targetDocxPath,
	);
	const targetParts = splitDocumentBody(
		targetDocumentXml,
		options.targetDocxPath,
	);
	const targetElements = splitTopLevelWordElements(targetParts.bodyContent);
	const sourceElements = getDocxBodyElements(
		sourceArchive,
		options.sourceDocxPath,
	).map(normalizeFrontMatterElement);
	const sourceBody = sourceElements.join('');

	if (RELATIONSHIP_REFERENCE_PATTERN.test(sourceBody)) {
		throw new Error(
			`${path.basename(options.sourceDocxPath)} contains relationship-bound content; merge relationships before inserting it.`,
		);
	}

	const insertIndex = findInsertIndex(targetElements, options.beforeText);
	const insertedElements = [
		...(options.addPageBreakBefore === false ? [] : [PAGE_BREAK_PARAGRAPH]),
		...sourceElements,
	];
	const mergedElements = [
		...targetElements.slice(0, insertIndex),
		...insertedElements,
		...targetElements.slice(insertIndex),
	];
	const updatedDocumentXml = [
		targetParts.beforeBody,
		targetParts.bodyOpen,
		mergedElements.join(''),
		targetParts.sectPr,
		targetParts.afterBody,
	].join('');

	targetArchive.updateFile(
		DOCUMENT_XML_PATH,
		Buffer.from(updatedDocumentXml, 'utf8'),
	);
	copyFrontMatterSettings(targetArchive, sourceArchive);
	fs.writeFileSync(options.targetDocxPath, targetArchive.toBuffer());
}
