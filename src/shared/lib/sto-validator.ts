import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	getNumberedHeadingStyleId,
	STO_RULES,
	STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	STRUCTURAL_HEADING_STYLE_ID,
} from '../config';

/**
 * STO Validation Suite
 * This script analyzes an unpacked .docx (XML) to ensure compliance with STO standards.
 */

export interface ValidationResult {
	check: string;
	passed: boolean;
	error?: string;
}

interface ValidationInput {
	docXml: string;
	stylesXml: string;
	numberingXml: string | null;
	footerXmlByType: Partial<Record<string, string>>;
	heading1StyleIds: readonly string[];
	heading1StyleRef: string;
	structuralHeadingStyleRef: string;
}

const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const OMATH_TAG = '<m:' + 'o' + 'Math';
const HANSI_ATTRIBUTE = 'w:h' + 'Ansi';

function decodeXmlText(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'");
}

function escapeRegExp(value: string): string {
	return value.replaceAll(REGEXP_SPECIAL_CHARS, String.raw`\$&`);
}

function regexMatches(pattern: RegExp, value: string): boolean {
	return pattern.exec(value) !== null;
}

function readXmlIfExists(filePath: string): string | null {
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function readFooterXmlByType(
	unpackedDirPath: string,
	docXml: string,
): Partial<Record<string, string>> {
	const relsXml = readXmlIfExists(
		path.join(unpackedDirPath, 'word', '_rels', 'document.xml.rels'),
	);
	if (relsXml === null) {
		return {};
	}

	const relationshipTargets = new Map(
		[
			...relsXml.matchAll(
				/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*>/g,
			),
		].map(match => [match[1], match[2]]),
	);
	const footers: Partial<Record<string, string>> = {};

	for (const match of docXml.matchAll(
		/<w:footerReference\b[^>]*\bw:type="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g,
	)) {
		const type = match[1];
		const target = relationshipTargets.get(match[2]);
		if (!target) {
			continue;
		}
		const normalizedTarget = target.replace(/^\/?word\//, '');
		const footerPath = path.join(unpackedDirPath, 'word', normalizedTarget);
		const footerXml = readXmlIfExists(footerPath);
		if (footerXml !== null) {
			footers[type] = footerXml;
		}
	}

	return footers;
}

function extractWordText(xml: string): string {
	return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(item => decodeXmlText(item[1]))
		.join('');
}

function getXmlAttribute(tagXml: string, attributeName: string): string | null {
	const escapedAttributeName = escapeRegExp(attributeName);
	const match = new RegExp(`${escapedAttributeName}="([^"]+)"`).exec(tagXml);
	return match?.[1] ?? null;
}

function passedResult(check: string): ValidationResult {
	return { check, passed: true };
}

function resultFromFailure(
	check: string,
	hasFailure: boolean,
	error: string,
): ValidationResult {
	if (hasFailure) {
		return { check, passed: false, error };
	}
	return passedResult(check);
}

function resultFromPass(
	check: string,
	isPassed: boolean,
	error: string,
): ValidationResult {
	if (isPassed) {
		return passedResult(check);
	}
	return { check, passed: false, error };
}

function extractCitationNumbers(text: string): number[] {
	const numbers = new Set<number>();

	for (const match of text.matchAll(/\[([\d,\s]+)]/g)) {
		for (const value of match[1].split(',')) {
			const number = Number(value.trim());
			if (Number.isInteger(number) && number > 0) {
				numbers.add(number);
			}
		}
	}

	return [...numbers].sort((left, right) => left - right);
}

function getMissingCitationNumbers(
	citationNumbers: readonly number[],
): number[] {
	const highestCitationNumber = citationNumbers.at(-1) ?? 0;
	const usedNumbers = new Set(citationNumbers);
	const missingNumbers: number[] = [];

	for (let number = 1; number <= highestCitationNumber; number++) {
		if (!usedNumbers.has(number)) {
			missingNumbers.push(number);
		}
	}

	return missingNumbers;
}

function hasFormulaPeriodBeforeWhere(docXml: string): boolean {
	const formulaBeforeWhere = new RegExp(
		String.raw`(<w:tbl[\s\S]*?<\/w:tbl>|<w:p[\s\S]*?${escapeRegExp(OMATH_TAG)}[\s\S]*?<\/w:p>)\s*<w:p[\s\S]*?<w:t[^>]*>где(?:\s|<|&nbsp;)`,
		'g',
	);

	for (const match of docXml.matchAll(formulaBeforeWhere)) {
		const formulaBlock = match[1];
		const mathText = [
			...formulaBlock.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g),
		]
			.map(item => decodeXmlText(item[1]).trim())
			.join('')
			.trim();

		if (mathText.endsWith('.')) {
			return true;
		}
	}

	return false;
}

function isMathLayoutTable(tableXml: string): boolean {
	return tableXml.includes(OMATH_TAG);
}

function countTablesWithoutHeaderRepeat(docXml: string): number {
	const tables = getReportTables(docXml);

	return tables.filter(tableXml => {
		if (isMathLayoutTable(tableXml)) {
			return false;
		}

		const [firstRow, secondRow] =
			tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
		if (firstRow && secondRow) {
			return !regexMatches(/<w:tblHeader\b/, firstRow);
		}

		return false;
	}).length;
}

function hasOversizedImages(docXml: string): boolean {
	const maxWidthEmu = STO_RULES.page.imageMaxWidthEmu;

	return [...docXml.matchAll(/<wp:extent\b[^>]*\bcx="(\d+)"/g)].some(
		match => Number(match[1]) > maxWidthEmu,
	);
}

function hasUncenteredImageParagraphs(docXml: string): boolean {
	const imageParagraphs = docXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];

	return imageParagraphs.some(
		paragraphXml =>
			paragraphXml.includes('<w:drawing') &&
			!regexMatches(/<w:jc\b[^>]*w:val="center"[^>]*\/>/, paragraphXml),
	);
}

function hasExpectedPageMargins(docXml: string): boolean {
	const margins = STO_RULES.page.marginsDxa;
	const marginTags = docXml.match(/<w:pgMar\b[^>]*\/>/g) ?? [];
	return (
		marginTags.length > 0 &&
		marginTags.every(
			marginTag =>
				getXmlAttribute(marginTag, 'w:top') === String(margins.top) &&
				getXmlAttribute(marginTag, 'w:bottom') ===
					String(margins.bottom) &&
				getXmlAttribute(marginTag, 'w:left') === String(margins.left) &&
				getXmlAttribute(marginTag, 'w:right') === String(margins.right),
		)
	);
}

function getBodyElements(docXml: string): string[] {
	const bodyXml = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(docXml)?.[1];
	return (
		bodyXml?.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g) ?? []
	);
}

function getReportBodyElements(docXml: string): string[] {
	const elements = getBodyElements(docXml);
	const reportStartIndex = elements.findIndex(
		elementXml =>
			isParagraphXml(elementXml) &&
			extractWordText(elementXml).trim().toLocaleUpperCase('ru-RU') ===
				'РЕФЕРАТ',
	);
	return reportStartIndex >= 0 ? elements.slice(reportStartIndex) : elements;
}

function getReportTables(docXml: string): string[] {
	return getReportBodyElements(docXml).filter(isTableXml);
}

function isParagraphXml(elementXml: string): boolean {
	return elementXml.startsWith('<w:p');
}

function isTableXml(elementXml: string): boolean {
	return elementXml.startsWith('<w:tbl');
}

function paragraphHasDrawing(paragraphXml: string): boolean {
	return paragraphXml.includes('<w:drawing');
}

function isVisibleParagraph(paragraphXml: string): boolean {
	return (
		extractWordText(paragraphXml).trim().length > 0 ||
		paragraphHasDrawing(paragraphXml)
	);
}

function paragraphHasStyle(paragraphXml: string, styleId: string): boolean {
	return getParagraphStyleId(paragraphXml) === styleId;
}

function findPreviousVisibleParagraph(
	elements: readonly string[],
	index: number,
): string | null {
	for (let current = index - 1; current >= 0; current--) {
		const elementXml = elements[current];
		if (!isParagraphXml(elementXml)) {
			return null;
		}
		if (isVisibleParagraph(elementXml)) {
			return elementXml;
		}
	}
	return null;
}

function findNextVisibleParagraph(
	elements: readonly string[],
	index: number,
): string | null {
	for (let current = index + 1; current < elements.length; current++) {
		const elementXml = elements[current];
		if (!isParagraphXml(elementXml)) {
			return null;
		}
		if (isVisibleParagraph(elementXml)) {
			return elementXml;
		}
	}
	return null;
}

function countTablesWithoutAdjacentCaption(docXml: string): number {
	const elements = getReportBodyElements(docXml);
	let count = 0;

	for (let index = 0; index < elements.length; index++) {
		const elementXml = elements[index];
		if (!isTableXml(elementXml) || isMathLayoutTable(elementXml)) {
			continue;
		}

		const previous = findPreviousVisibleParagraph(elements, index);
		const previousText = previous ? extractWordText(previous).trim() : '';
		if (
			!previous ||
			!paragraphHasStyle(previous, 'TableCaption') ||
			!/^Таблица\s+/i.test(previousText)
		) {
			count++;
		}
	}

	return count;
}

function countImagesWithoutFollowingCaption(docXml: string): number {
	const elements = getReportBodyElements(docXml);
	let count = 0;

	for (let index = 0; index < elements.length; index++) {
		const elementXml = elements[index];
		if (!isParagraphXml(elementXml) || !paragraphHasDrawing(elementXml)) {
			continue;
		}

		const next = findNextVisibleParagraph(elements, index);
		const nextText = next ? extractWordText(next).trim() : '';
		if (
			!next ||
			!paragraphHasStyle(next, 'FigureCaption') ||
			!/^Рисунок\s+/i.test(nextText)
		) {
			count++;
		}
	}

	return count;
}

function getNumberingLevels(numberingXml: string): string[] {
	return numberingXml.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? [];
}

function hasExpectedBibliographyNumbering(numberingXml: string): boolean {
	const bibliographyParagraph = STO_RULES.bibliography.paragraph;
	const bibliographyIndentPattern = new RegExp(
		String.raw`<w:ind\b(?=[^>]*w:left="${bibliographyParagraph.leftIndentDxa}")(?=[^>]*w:hanging="${bibliographyParagraph.hangingIndentDxa}")`,
	);

	return getNumberingLevels(numberingXml).some(
		levelXml =>
			regexMatches(/<w:lvlText w:val="%1"\/>/, levelXml) &&
			regexMatches(bibliographyIndentPattern, levelXml) &&
			!regexMatches(/<w:suff\b[^>]*w:val="space"/, levelXml),
	);
}

function countTablesWithDiagonalBorders(docXml: string): number {
	const tables = getReportTables(docXml);
	return tables.filter(
		tableXml =>
			!isMathLayoutTable(tableXml) &&
			(regexMatches(/<w:tl2br\b/, tableXml) ||
				regexMatches(/<w:tr2bl\b/, tableXml)),
	).length;
}

function hasExpectedDefaultFont(stylesXml: string): boolean {
	const font = escapeRegExp(STO_RULES.typography.fontFamily);
	return regexMatches(
		new RegExp(
			String.raw`<w:rFonts\b[^>]*(?:w:ascii="${font}"|${HANSI_ATTRIBUTE}="${font}")`,
		),
		stylesXml,
	);
}

function hasExpectedDefaultFontSize(stylesXml: string): boolean {
	return regexMatches(
		new RegExp(
			String.raw`<w:sz\b[^>]*w:val="${STO_RULES.typography.fontSizeHalfPoints}"`,
		),
		stylesXml,
	);
}

function findStyleXml(stylesXml: string, styleId: string): string | null {
	const escapedStyleId = escapeRegExp(styleId);
	return (
		new RegExp(
			String.raw`<w:style\b(?=[^>]*\bw:styleId="${escapedStyleId}")[\s\S]*?<\/w:style>`,
		).exec(stylesXml)?.[0] ?? null
	);
}

function getStyleName(stylesXml: string, styleId: string): string | null {
	const styleXml = findStyleXml(stylesXml, styleId);
	if (!styleXml) {
		return null;
	}
	const nameTag = /<w:name\b[^>]*\/>/.exec(styleXml)?.[0];
	return nameTag ? getXmlAttribute(nameTag, 'w:val') : null;
}

function findStyleIdsByName(stylesXml: string, styleName: string): string[] {
	const escapedStyleName = escapeRegExp(styleName);
	const ids: string[] = [];

	for (const match of stylesXml.matchAll(
		/<w:style\b(?=[^>]*\bw:styleId="([^"]+)")[\s\S]*?<\/w:style>/g,
	)) {
		if (
			regexMatches(
				new RegExp(
					String.raw`<w:name\b[^>]*w:val="${escapedStyleName}"`,
				),
				match[0],
			)
		) {
			ids.push(match[1]);
		}
	}

	return ids;
}

function getBasedOnStyleId(styleXml: string): string | null {
	const basedOnTag = /<w:basedOn\b[^>]*\/>/.exec(styleXml)?.[0];
	return basedOnTag ? getXmlAttribute(basedOnTag, 'w:val') : null;
}

function getWordNormalizedStyleId(styleId: string): string | null {
	if (styleId.startsWith('StoHeading')) {
		return styleId.replace('StoHeading', 'STOHeading');
	}
	return null;
}

function expandStyleIds(styleIds: readonly string[]): string[] {
	return [
		...new Set(
			styleIds.flatMap(styleId =>
				[styleId, getWordNormalizedStyleId(styleId)].filter(
					(value): value is string => value !== null,
				),
			),
		),
	];
}

function hasStyleProperty(
	stylesXml: string,
	styleIds: readonly string[],
	propertyPattern: RegExp,
): boolean {
	return expandStyleIds(styleIds).some(styleId => {
		const styleXml = findStyleXml(stylesXml, styleId);
		return styleXml ? regexMatches(propertyPattern, styleXml) : false;
	});
}

function hasStylePropertyOrInherited(
	stylesXml: string,
	styleIds: readonly string[],
	propertyPattern: RegExp,
	visitedStyleIds = new Set<string>(),
): boolean {
	return expandStyleIds(styleIds).some(styleId => {
		if (visitedStyleIds.has(styleId)) {
			return false;
		}
		visitedStyleIds.add(styleId);

		const styleXml = findStyleXml(stylesXml, styleId);
		if (!styleXml) {
			return false;
		}
		if (regexMatches(propertyPattern, styleXml)) {
			return true;
		}

		const basedOnStyleId = getBasedOnStyleId(styleXml);
		return basedOnStyleId
			? hasStylePropertyOrInherited(
					stylesXml,
					[basedOnStyleId],
					propertyPattern,
					visitedStyleIds,
				)
			: false;
	});
}

function expandStyleIdsByName(
	stylesXml: string,
	styleIdsOrNames: readonly string[],
): string[] {
	return [
		...new Set(
			styleIdsOrNames.flatMap(styleIdOrName => [
				styleIdOrName,
				...findStyleIdsByName(stylesXml, styleIdOrName),
			]),
		),
	];
}

function hasStylePropertyOrInheritedByIdOrName(
	stylesXml: string,
	styleIdsOrNames: readonly string[],
	propertyPattern: RegExp,
): boolean {
	return hasStylePropertyOrInherited(
		stylesXml,
		expandStyleIdsByName(stylesXml, styleIdsOrNames),
		propertyPattern,
	);
}

function countEmptyTableCells(docXml: string): number {
	const tables = getReportTables(docXml);
	let emptyCells = 0;

	for (const tableXml of tables) {
		if (isMathLayoutTable(tableXml)) {
			continue;
		}

		const cells = tableXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
		emptyCells += cells.filter(cellXml => {
			const text = extractWordText(cellXml).trim();
			return (
				text.length === 0 &&
				!cellXml.includes('<w:drawing') &&
				!cellXml.includes('<w:br')
			);
		}).length;
	}

	return emptyCells;
}

function countTableHeaderFinalPeriods(docXml: string): number {
	const tables = getReportTables(docXml);
	let cellsWithFinalPeriod = 0;

	for (const tableXml of tables) {
		if (isMathLayoutTable(tableXml)) {
			continue;
		}

		const firstRow = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
		if (!firstRow) {
			continue;
		}

		const cells = firstRow.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
		cellsWithFinalPeriod += cells.filter(cellXml =>
			/[.]$/.test(extractWordText(cellXml).trim()),
		).length;
	}

	return cellsWithFinalPeriod;
}

function getParagraphStyleId(paragraphXml: string): string | null {
	const styleTag = /<w:pStyle\b[^>]*\/>/.exec(paragraphXml)?.[0];
	return styleTag ? getXmlAttribute(styleTag, 'w:val') : null;
}

function hasRunLevelTab(paragraphXml: string): boolean {
	const runs = paragraphXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
	return runs.some(runXml => regexMatches(/<w:tab\b/, runXml));
}

function isAllowedLayoutTabParagraph(
	paragraphXml: string,
	stylesXml: string,
): boolean {
	const styleId = getParagraphStyleId(paragraphXml);
	if (!styleId) {
		return false;
	}
	if (styleId === 'TitlePageText') {
		return true;
	}

	const styleName = getStyleName(stylesXml, styleId);
	return styleName ? /^toc\s+\d+$/i.test(styleName) : false;
}

function hasForbiddenTabCharacters(docXml: string, stylesXml: string): boolean {
	const paragraphs = docXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
	return paragraphs.some(
		paragraphXml =>
			(hasRunLevelTab(paragraphXml) ||
				extractWordText(paragraphXml).includes('\t')) &&
			!isAllowedLayoutTabParagraph(paragraphXml, stylesXml),
	);
}

function validateHeadingText(input: ValidationInput): ValidationResult[] {
	const capsHeading1 = regexMatches(
		new RegExp(
			String.raw`${input.heading1StyleRef}(?:(?!<\/w:p>).)*?<w:t>([^<]*[А-ЯA-Z]{5,}[^<]*)<\/w:t>`,
			's',
		),
		input.docXml,
	);
	const structuralHeadingLowerText = regexMatches(
		new RegExp(
			String.raw`${input.structuralHeadingStyleRef}(?:(?!<\/w:p>).)*?<w:t>[^<]*[a-zа-яё][^<]*<\/w:t>`,
			's',
		),
		input.docXml,
	);
	const hasAllCapsStyle = hasStyleProperty(
		input.stylesXml,
		[STRUCTURAL_HEADING_STYLE_ID],
		/<w:caps\/>/,
	);
	const structuralCasingPassed = structuralHeadingLowerText
		? hasAllCapsStyle
		: true;

	return [
		resultFromFailure(
			'Heading 1 Casing',
			capsHeading1,
			'Detected ALL-CAPS text in Heading 1 (should be Sentence case).',
		),
		resultFromPass(
			'Structural Heading Casing',
			structuralCasingPassed,
			'Detected lowercase text in Structural Heading and style does not force ALL CAPS.',
		),
	];
}

function validateTypography(input: ValidationInput): ValidationResult[] {
	const firstLineIndent = STO_RULES.typography.firstLineIndentDxa;
	const docDefaultsSpacing = regexMatches(
		new RegExp(
			String.raw`\x3Cw:pPrDefault>.*?\x3Cw:spacing [^>]*?w:line="${STO_RULES.typography.normalLineSpacingDxa}"`,
			's',
		),
		input.stylesXml,
	);
	const docDefaultsAlignment = regexMatches(
		/\x3Cw:pPrDefault>.*?\x3Cw:jc\b[^>]*w:val="both"/s,
		input.stylesXml,
	);
	const normalStyleIndent = hasStylePropertyOrInheritedByIdOrName(
		input.stylesXml,
		['Normal'],
		new RegExp(String.raw`<w:ind\b[^>]*w:firstLine="${firstLineIndent}"`),
	);
	const normalStyleAlignment =
		hasStylePropertyOrInheritedByIdOrName(
			input.stylesXml,
			['Normal'],
			/<w:jc\b[^>]*w:val="both"[^>]*\/>/,
		) || docDefaultsAlignment;
	const normalStyleIndentAndAlignment =
		normalStyleIndent && normalStyleAlignment;

	return [
		resultFromFailure(
			'Dash Type (En-dash)',
			extractWordText(input.docXml).includes(
				STO_RULES.typography.forbiddenDash,
			),
			`Detected long dash (em-dash). Use en-dash (${STO_RULES.typography.recommendedDash}).`,
		),
		resultFromPass(
			'Normal Line Spacing (1.5)',
			docDefaultsSpacing,
			`Normal style line spacing is not 1.5 (${STO_RULES.typography.normalLineSpacingDxa} DXA).`,
		),
		resultFromPass(
			'Default Font',
			hasExpectedDefaultFont(input.stylesXml),
			`Default font must be ${STO_RULES.typography.fontFamily}.`,
		),
		resultFromPass(
			'Default Font Size',
			hasExpectedDefaultFontSize(input.stylesXml),
			`Default font size must be ${STO_RULES.typography.fontSizePoints} pt.`,
		),
		resultFromPass(
			'Normal Paragraph Indent & Alignment',
			normalStyleIndentAndAlignment,
			`Normal style must be justified and use first-line indent ${firstLineIndent} DXA.`,
		),
		resultFromPass(
			'Page Margins',
			hasExpectedPageMargins(input.docXml),
			'Every section must use STO margins: left 30 mm, right 15 mm, top/bottom 20 mm.',
		),
	];
}

function hasCenteredPageNumber(footerXml: string | undefined): boolean {
	if (!footerXml || !regexMatches(/\bPAGE\b/, footerXml)) {
		return false;
	}
	return (footerXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).some(
		paragraphXml =>
			regexMatches(/\bPAGE\b/, paragraphXml) &&
			regexMatches(/<w:jc\b[^>]*w:val="center"[^>]*\/>/, paragraphXml),
	);
}

function hasVisiblePageNumber(footerXml: string | undefined): boolean {
	return footerXml ? regexMatches(/\bPAGE\b/, footerXml) : false;
}

function validatePageNumbering(input: ValidationInput): ValidationResult[] {
	const hasTitlePage = regexMatches(/<w:titlePg\b/, input.docXml);
	const firstFooter = input.footerXmlByType.first;
	const titlePageNumberHidden =
		hasTitlePage && !hasVisiblePageNumber(firstFooter);

	return [
		resultFromPass(
			'Page Number Footer',
			hasCenteredPageNumber(input.footerXmlByType.default),
			'Page number must be in the centered default footer.',
		),
		resultFromPass(
			'Title Page Number Hidden',
			titlePageNumberHidden,
			'Title page must be included in numbering but must not display a page number.',
		),
	];
}

function validateMathAndCitations(docXml: string): ValidationResult[] {
	const documentText = extractWordText(docXml);
	const citationNumbers = extractCitationNumbers(documentText);
	const missingCitationNumbers = getMissingCitationNumbers(citationNumbers);
	const highestCitationNumber = citationNumbers.at(-1) ?? 0;
	const legacyBibliographyMarkers = [
		'[Текст]',
		'[Электронный ресурс]',
		'Электрон. дан.',
	];

	return [
		resultFromFailure(
			'Citation Formatting',
			regexMatches(/\[@[^\]]+]/, documentText),
			'Detected unparsed citations (e.g. [@key]).',
		),
		resultFromPass(
			'Citation Number Sequence',
			missingCitationNumbers.length === 0,
			`Citation numbers must be dense from [1] to [${highestCitationNumber}]; missing: ${missingCitationNumbers.join(', ')}.`,
		),
		resultFromFailure(
			'Bibliography Legacy Resource Markers',
			legacyBibliographyMarkers.some(marker =>
				documentText.includes(marker),
			),
			`Detected legacy bibliography marker. Do not use ${legacyBibliographyMarkers.join(', ')} in source-list records.`,
		),
		resultFromFailure(
			'Math Formatting (Unparsed)',
			regexMatches(/\$[^$]+\$/, docXml),
			'Detected unparsed LaTeX math ($...$).',
		),
		resultFromFailure(
			'Math Multiplication Sign',
			regexMatches(/<m:t>[^<]*\*[^<]*<\/m:t>/, docXml),
			'Detected asterisk (*) as multiplication sign in formula. Use LaTeX multiplication commands instead.',
		),
		resultFromFailure(
			'Math Decimal Separator',
			regexMatches(/<m:t>[^<]*\d+\.\d+[^<]*<\/m:t>/, docXml),
			'Detected dot (.) as decimal separator in formula. Russian typography requires a comma (,).',
		),
		resultFromFailure(
			'Formula Punctuation Before Where',
			hasFormulaPeriodBeforeWhere(docXml),
			'Detected a block formula ending with a period before a lowercase "где" explanation. Use a comma or no final period.',
		),
	];
}

function validateFieldsTablesAndImages(
	input: ValidationInput,
): ValidationResult[] {
	const emptyTableCells = countEmptyTableCells(input.docXml);
	const tableHeaderFinalPeriods = countTableHeaderFinalPeriods(input.docXml);
	const tablesWithoutHeaderRepeat = countTablesWithoutHeaderRepeat(
		input.docXml,
	);
	const tablesWithoutAdjacentCaption = countTablesWithoutAdjacentCaption(
		input.docXml,
	);
	const imagesWithoutFollowingCaption = countImagesWithoutFollowingCaption(
		input.docXml,
	);
	const tablesWithDiagonalBorders = countTablesWithDiagonalBorders(
		input.docXml,
	);

	return [
		resultFromFailure(
			'Dirty Field Flags',
			regexMatches(/<w:fldChar\b[^>]*w:dirty="(?:true|1)"/, input.docXml),
			'Detected dirty Word fields. Run post_build.py so Word does not ask to update fields on open.',
		),
		resultFromFailure(
			'Tab Characters',
			hasForbiddenTabCharacters(input.docXml, input.stylesXml),
			'Detected body tab characters. Use paragraph indentation and styles instead of manual tabs.',
		),
		resultFromPass(
			'Empty Table Cells',
			emptyTableCells === 0,
			`Detected ${emptyTableCells} empty table cell(s). STO tables should not contain blank cells.`,
		),
		resultFromPass(
			'Table Header Final Period',
			tableHeaderFinalPeriods === 0,
			`Detected ${tableHeaderFinalPeriods} table header cell(s) ending with a final dot.`,
		),
		resultFromPass(
			'Table Header Repeat',
			tablesWithoutHeaderRepeat === 0,
			`Detected ${tablesWithoutHeaderRepeat} table(s) without repeated header rows.`,
		),
		resultFromPass(
			'Table Caption Adjacency',
			tablesWithoutAdjacentCaption === 0,
			`Detected ${tablesWithoutAdjacentCaption} table(s) without an immediate TableCaption paragraph before the table.`,
		),
		resultFromPass(
			'Table Diagonal Borders',
			tablesWithDiagonalBorders === 0,
			`Detected ${tablesWithDiagonalBorders} table(s) with diagonal cell borders.`,
		),
		resultFromFailure(
			'Image Width Limit',
			hasOversizedImages(input.docXml),
			'Detected image width above 14 cm. Run post_build.py to scale large figures.',
		),
		resultFromFailure(
			'Image Paragraph Alignment',
			hasUncenteredImageParagraphs(input.docXml),
			'Detected an image paragraph without center alignment.',
		),
		resultFromPass(
			'Figure Caption Adjacency',
			imagesWithoutFollowingCaption === 0,
			`Detected ${imagesWithoutFollowingCaption} image paragraph(s) without an immediate FigureCaption paragraph after the image.`,
		),
	];
}

function validateNumbering(numberingXml: string | null): ValidationResult[] {
	if (numberingXml === null) {
		return [];
	}

	const firstLineIndent = STO_RULES.typography.firstLineIndentDxa;
	const bibliographyParagraph = STO_RULES.bibliography.paragraph;
	const bibLevelMatch = hasExpectedBibliographyNumbering(numberingXml);
	const listLevelMatch = regexMatches(
		new RegExp(
			String.raw`<w:lvlText w:val="${escapeRegExp(STO_RULES.typography.listMarker)}"/>.*?<w:ind[^>]*w:left="0"[^>]*w:firstLine="${firstLineIndent}"`,
			's',
		),
		numberingXml,
	);

	return [
		resultFromPass(
			'Bibliography Numbering Indent & Format',
			bibLevelMatch,
			`Bibliography numbering missing or has incorrect indent/suffix (expected left ${bibliographyParagraph.leftIndentDxa}, hanging ${bibliographyParagraph.hangingIndentDxa}, tab after number) / dot format.`,
		),
		resultFromPass(
			'List Numbering Indent & Format',
			listLevelMatch,
			`List numbering missing ${STO_RULES.typography.listMarker} marker or has incorrect indent (expected left 0, firstLine ${firstLineIndent}).`,
		),
	];
}

function validateHeadingStyles(input: ValidationInput): ValidationResult[] {
	const heading1PageBreak = hasStylePropertyOrInherited(
		input.stylesXml,
		input.heading1StyleIds,
		/<w:pageBreakBefore\b/,
	);
	const structuralPageBreak = [
		STRUCTURAL_HEADING_STYLE_ID,
		STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	].every(styleId =>
		hasStylePropertyOrInherited(
			input.stylesXml,
			[styleId],
			/<w:pageBreakBefore\b/,
		),
	);

	return [
		resultFromFailure(
			'Numbered Heading Alignment',
			hasStyleProperty(
				input.stylesXml,
				input.heading1StyleIds,
				/<w:jc\b[^>]*w:val="center"[^>]*\/>/,
			),
			'Numbered headings (Heading1) must not be centered.',
		),
		resultFromPass(
			'Structural Heading Alignment',
			hasStyleProperty(
				input.stylesXml,
				[STRUCTURAL_HEADING_STYLE_ID],
				/<w:jc\b[^>]*w:val="center"[^>]*\/>/,
			),
			'Structural headings must be centered.',
		),
		resultFromPass(
			'Heading 1 Page Break',
			heading1PageBreak,
			'Heading 1 must have a pageBreakBefore.',
		),
		resultFromPass(
			'Structural Heading Page Break',
			structuralPageBreak,
			'Structural headings must have a pageBreakBefore.',
		),
	];
}

function validateCaptionStyles(stylesXml: string): ValidationResult[] {
	const captionLineSpacingPattern = new RegExp(
		String.raw`<w:spacing\b[^>]*w:line="${STO_RULES.typography.captionLineSpacingDxa}"`,
	);
	const zeroFirstLinePattern = /<w:ind\b[^>]*w:firstLine="0"/;

	return [
		resultFromPass(
			'Figure Caption Style',
			hasStyleProperty(
				stylesXml,
				['FigureCaption'],
				captionLineSpacingPattern,
			) &&
				hasStyleProperty(
					stylesXml,
					['FigureCaption'],
					/<w:jc\b[^>]*w:val="center"[^>]*\/>/,
				) &&
				hasStyleProperty(
					stylesXml,
					['FigureCaption'],
					zeroFirstLinePattern,
				),
			`FigureCaption style must be centered, have no first-line indent, and use single line spacing (${STO_RULES.typography.captionLineSpacingDxa} DXA).`,
		),
		resultFromPass(
			'Table Caption Style',
			hasStyleProperty(
				stylesXml,
				['TableCaption'],
				captionLineSpacingPattern,
			) &&
				hasStyleProperty(
					stylesXml,
					['TableCaption'],
					/<w:jc\b[^>]*w:val="left"[^>]*\/>/,
				) &&
				hasStyleProperty(
					stylesXml,
					['TableCaption'],
					zeroFirstLinePattern,
				),
			`TableCaption style must be left-aligned, have no first-line indent, and use single line spacing (${STO_RULES.typography.captionLineSpacingDxa} DXA).`,
		),
		resultFromPass(
			'Table Text Style',
			hasStyleProperty(
				stylesXml,
				['TableText'],
				captionLineSpacingPattern,
			) &&
				hasStyleProperty(
					stylesXml,
					['TableText'],
					zeroFirstLinePattern,
				),
			`TableText style must have no first-line indent and use single line spacing (${STO_RULES.typography.captionLineSpacingDxa} DXA).`,
		),
	];
}

function createValidationInput(
	docXml: string,
	stylesXml: string,
	numberingXml: string | null,
	footerXmlByType: Partial<Record<string, string>>,
): ValidationInput {
	const heading1StyleIds = [getNumberedHeadingStyleId(1), 'Heading1', '1'];
	const heading1StyleRef = `<w:pStyle w:val="(?:${heading1StyleIds.map(escapeRegExp).join('|')})"/>`;
	const structuralHeadingStyleRef = `<w:pStyle w:val="${escapeRegExp(STRUCTURAL_HEADING_STYLE_ID)}"/>`;

	return {
		docXml,
		stylesXml,
		numberingXml,
		footerXmlByType,
		heading1StyleIds,
		heading1StyleRef,
		structuralHeadingStyleRef,
	};
}

export function validateSTO(unpackedDirPath: string): ValidationResult[] {
	const documentXmlPath = path.join(unpackedDirPath, 'word', 'document.xml');
	const stylesXmlPath = path.join(unpackedDirPath, 'word', 'styles.xml');
	const numberingXmlPath = path.join(
		unpackedDirPath,
		'word',
		'numbering.xml',
	);

	if (!fs.existsSync(documentXmlPath)) {
		return [
			{
				check: 'File Existence',
				passed: false,
				error: 'document.xml not found',
			},
		];
	}

	const stylesXml = readXmlIfExists(stylesXmlPath);
	if (stylesXml === null) {
		return [
			{
				check: 'File Existence',
				passed: false,
				error: 'styles.xml not found',
			},
		];
	}

	const input = createValidationInput(
		fs.readFileSync(documentXmlPath, 'utf8'),
		stylesXml,
		readXmlIfExists(numberingXmlPath),
		readFooterXmlByType(
			unpackedDirPath,
			fs.readFileSync(documentXmlPath, 'utf8'),
		),
	);

	return [
		...validateHeadingText(input),
		...validateTypography(input),
		...validatePageNumbering(input),
		...validateMathAndCitations(input.docXml),
		...validateNumbering(input.numberingXml),
		...validateFieldsTablesAndImages(input),
		...validateHeadingStyles(input),
		...validateCaptionStyles(input.stylesXml),
	];
}

if (require.main === module) {
	const dir = process.argv[2];
	if (dir) {
		const report = validateSTO(dir);
		console.table(report);
		process.exit(report.every(r => r.passed) ? 0 : 1);
	}
}
