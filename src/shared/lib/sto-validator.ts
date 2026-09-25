import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	getNumberedHeadingStyleId,
	STO_RULES,
	STRUCTURAL_HEADING_STYLE_ID,
} from '../config';
import { validateTemplateStyleConformance } from './sto-template-style-validator';
import {
	decodeXmlText,
	extractWordText,
	getBodyElements,
	getContinuationFailures,
	getNoteFailures,
	getParagraphStyleId,
	getReportBodyElements,
	getReportTables,
	isParagraphXml,
	isTableXml,
	isVisibleParagraph,
	paragraphHasDrawing,
	paragraphHasStyle,
} from './sto-validator/body-xml';
import {
	getEffectiveBodyParagraphAttribute,
	getEffectiveParagraphAttribute,
	resolveWordStyleId,
} from './word-style-properties';

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

function countTablesWithoutAdjacentCaption(
	docXml: string,
	stylesXml: string,
): number {
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
			!paragraphHasStyle(previous, stylesXml, 'TableCaption') ||
			!/^(?:Таблица|Продолжение таблицы)\s+/i.test(previousText)
		) {
			count++;
		}
	}

	return count;
}

function countImagesWithoutFollowingCaption(
	docXml: string,
	stylesXml: string,
): number {
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
			!paragraphHasStyle(next, stylesXml, 'FigureCaption') ||
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

function expandStyleIds(
	stylesXml: string,
	styleIds: readonly string[],
): string[] {
	return [
		...new Set(
			styleIds
				.map(styleId => resolveWordStyleId(stylesXml, styleId))
				.filter((value): value is string => value !== null),
		),
	];
}

function hasStyleProperty(
	stylesXml: string,
	styleIds: readonly string[],
	propertyPattern: RegExp,
): boolean {
	return expandStyleIds(stylesXml, styleIds).some(styleId => {
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
	return expandStyleIds(stylesXml, styleIds).some(styleId => {
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

function hasInvalidDirectBodyFormatting(
	docXml: string,
	stylesXml: string,
	numberingXml: string | null,
): boolean {
	let inReferat = false;
	return getBodyElements(docXml).some(paragraphXml => {
		if (!isParagraphXml(paragraphXml) || !isVisibleParagraph(paragraphXml))
			return false;
		const text = extractWordText(paragraphXml).trim();
		const headingText = text.toLocaleUpperCase('ru-RU');
		if (headingText === 'РЕФЕРАТ') inReferat = true;
		if (headingText === 'СОДЕРЖАНИЕ' || headingText === 'ВВЕДЕНИЕ')
			inReferat = false;
		const styleId = getParagraphStyleId(paragraphXml);
		const runs = paragraphXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
		const isCodeBlock =
			runs.length > 0 && runs.every(run => run.includes('Courier New'));
		const styleName = styleId ? getStyleName(stylesXml, styleId) : null;
		if (
			styleId !== null &&
			styleId !== 'Normal' &&
			styleName !== 'Normal' &&
			styleName !== '+Абзац с отступом 1-ой строки'
		)
			return false;
		if (
			paragraphXml.includes('<w:numPr') ||
			paragraphXml.includes('<w:drawing') ||
			isCodeBlock ||
			(inReferat && paragraphXml.includes('<w:caps')) ||
			/^где(?:\s|$)/iu.test(text)
		)
			return false;

		const effective = (tag: string, attribute: string) =>
			getEffectiveBodyParagraphAttribute(
				paragraphXml,
				stylesXml,
				numberingXml,
				styleId ?? 'Normal',
				tag,
				attribute,
			);
		const runSpacing = [
			...paragraphXml.matchAll(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/g),
		]
			.map(match => /<w:spacing\b[^>]*\/>/.exec(match[1])?.[0] ?? '')
			.filter(Boolean);
		const invalidAttribute = (
			tag: string,
			name: string,
			expected: number,
		) => {
			const value = effective(tag, name);
			return value !== null && Number(value) !== expected;
		};
		return (
			effective('jc', 'val') !== 'both' ||
			invalidAttribute('ind', 'left', 0) ||
			invalidAttribute('ind', 'right', 0) ||
			invalidAttribute(
				'ind',
				'firstLine',
				STO_RULES.typography.firstLineIndentDxa,
			) ||
			effective('ind', 'firstLine') === null ||
			effective('ind', 'hanging') !== null ||
			runSpacing.some(tag => {
				const value = getXmlAttribute(tag, 'w:val');
				return value !== null && Number(value) !== 0;
			}) ||
			invalidAttribute('spacing', 'before', 0) ||
			invalidAttribute('spacing', 'after', 0) ||
			invalidAttribute(
				'spacing',
				'line',
				STO_RULES.typography.normalLineSpacingDxa,
			) ||
			effective('spacing', 'line') === null ||
			(effective('spacing', 'lineRule') !== null &&
				effective('spacing', 'lineRule') !== 'auto')
		);
	});
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
	const normalStyleIndent =
		getEffectiveParagraphAttribute(
			input.stylesXml,
			'Normal',
			'ind',
			'firstLine',
		) === String(firstLineIndent);
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
		resultFromFailure(
			'Direct Body Paragraph Formatting',
			hasInvalidDirectBodyFormatting(
				input.docXml,
				input.stylesXml,
				input.numberingXml,
			),
			'Body paragraph has a direct alignment, indent, or spacing override outside STO values.',
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
			'Math XML Elements',
			regexMatches(/<undefined(?:\s|>|\/)/, docXml),
			'Detected invalid <undefined> element in generated math XML.',
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
	const continuation = getContinuationFailures(input.docXml, input.stylesXml);
	const notes = getNoteFailures(input.docXml);
	const emptyTableCells = countEmptyTableCells(input.docXml);
	const tableHeaderFinalPeriods = countTableHeaderFinalPeriods(input.docXml);
	const tablesWithoutHeaderRepeat = countTablesWithoutHeaderRepeat(
		input.docXml,
	);
	const tablesWithoutAdjacentCaption = countTablesWithoutAdjacentCaption(
		input.docXml,
		input.stylesXml,
	);
	const imagesWithoutFollowingCaption = countImagesWithoutFollowingCaption(
		input.docXml,
		input.stylesXml,
	);
	const tablesWithDiagonalBorders = countTablesWithDiagonalBorders(
		input.docXml,
	);

	return [
		resultFromPass(
			'Table Continuation Label',
			continuation.label === 0,
			`Detected ${continuation.label} invalid table continuation label(s); use left-aligned "Продолжение таблицы N" immediately before the next segment.`,
		),
		resultFromPass(
			'Table Continuation Bottom Border',
			continuation.border === 0,
			`Detected ${continuation.border} continued table segment(s) with a bottom border.`,
		),
		resultFromPass(
			'Note Placement',
			notes.placement === 0,
			`Detected ${notes.placement} note(s) without preceding content.`,
		),
		resultFromPass(
			'Note Form',
			notes.form === 0,
			`Detected ${notes.form} malformed note(s); use "Примечание – ..." or "Примечания" followed by numbered paragraphs.`,
		),
		resultFromPass(
			'Table Note End',
			notes.tableEnd === 0,
			`Detected ${notes.tableEnd} table note(s) placed before another table segment.`,
		),
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

function createValidationInput(
	docXml: string,
	stylesXml: string,
	numberingXml: string | null,
	footerXmlByType: Partial<Record<string, string>>,
): ValidationInput {
	const heading1StyleIds = [getNumberedHeadingStyleId(1), 'Heading1', '1'];
	const resolvedHeading1StyleIds = heading1StyleIds
		.map(styleId => resolveWordStyleId(stylesXml, styleId))
		.filter((styleId): styleId is string => styleId !== null);
	const heading1StyleRef = `<w:pStyle w:val="(?:${resolvedHeading1StyleIds.map(escapeRegExp).join('|')})"/>`;
	const resolvedStructuralHeadingStyleId = resolveWordStyleId(
		stylesXml,
		STRUCTURAL_HEADING_STYLE_ID,
	);
	const structuralHeadingStyleRef = `<w:pStyle w:val="${escapeRegExp(resolvedStructuralHeadingStyleId ?? STRUCTURAL_HEADING_STYLE_ID)}"/>`;

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
		...validateTemplateStyleConformance(
			input.stylesXml,
			input.numberingXml,
			input.heading1StyleIds,
		),
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
