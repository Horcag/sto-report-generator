import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const DOCUMENT_XML_PATH = 'word/document.xml';
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
		const openingMatch = /^<w:([A-Za-z0-9]+)(?:\s[^>]*)?>/.exec(
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

function normalizeFrontMatterParagraph(
	paragraphXml: string,
	fontSizeHalfPoints = '24',
): string {
	const propertiesMatch = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(paragraphXml);
	if (!propertiesMatch) {
		const updatedParagraphXml = paragraphXml.replace(
			/(<w:p\b[^>]*>)/,
			`$1<w:pPr>${FRONT_MATTER_PARAGRAPH_DEFAULTS}</w:pPr>`,
		);
		return updatedParagraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, runXml =>
			normalizeFrontMatterRun(runXml, fontSizeHalfPoints),
		);
	}

	let propertiesXml = propertiesMatch[0];
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

	const updatedParagraphXml =
		paragraphXml.slice(0, propertiesMatch.index) +
		propertiesXml +
		paragraphXml.slice(propertiesMatch.index + propertiesMatch[0].length);

	return updatedParagraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, runXml =>
		normalizeFrontMatterRun(runXml, fontSizeHalfPoints),
	);
}

function normalizeFrontMatterElement(elementXml: string): string {
	if (elementXml.startsWith('<w:p')) {
		return normalizeFrontMatterParagraph(elementXml);
	}
	if (elementXml.startsWith('<w:tbl')) {
		return elementXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, paragraphXml =>
			normalizeFrontMatterParagraph(paragraphXml, '20'),
		);
	}
	return elementXml;
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
	fs.writeFileSync(options.targetDocxPath, targetArchive.toBuffer());
}
