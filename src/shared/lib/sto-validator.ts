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
	const tables = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];

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
	const marginTag = /<w:pgMar\b[^>]*\/>/.exec(docXml)?.[0];
	if (marginTag) {
		return (
			getXmlAttribute(marginTag, 'w:top') === String(margins.top) &&
			getXmlAttribute(marginTag, 'w:bottom') === String(margins.bottom) &&
			getXmlAttribute(marginTag, 'w:left') === String(margins.left) &&
			getXmlAttribute(marginTag, 'w:right') === String(margins.right)
		);
	}

	return false;
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

function countEmptyTableCells(docXml: string): number {
	const tables = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
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
	const docDefaultsSpacing = regexMatches(
		new RegExp(
			String.raw`\x3Cw:pPrDefault>.*?\x3Cw:spacing [^>]*?w:line="${STO_RULES.typography.normalLineSpacingDxa}"`,
			's',
		),
		input.stylesXml,
	);

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
			'Page Margins',
			hasExpectedPageMargins(input.docXml),
			'Page margins do not match STO defaults: left 30 mm, right 15 mm, top/bottom 20 mm.',
		),
	];
}

function validateMathAndCitations(docXml: string): ValidationResult[] {
	return [
		resultFromFailure(
			'Citation Formatting',
			regexMatches(/\[@[^\]]+]/, docXml),
			'Detected unparsed citations (e.g. [@key]).',
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
	const tablesWithoutHeaderRepeat = countTablesWithoutHeaderRepeat(
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
			'Table Header Repeat',
			tablesWithoutHeaderRepeat === 0,
			`Detected ${tablesWithoutHeaderRepeat} table(s) without repeated header rows.`,
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
	];
}

function validateNumbering(numberingXml: string | null): ValidationResult[] {
	if (numberingXml === null) {
		return [];
	}

	const firstLineIndent = STO_RULES.typography.firstLineIndentDxa;
	const bibLevelMatch = regexMatches(
		new RegExp(
			String.raw`<w:lvlText w:val="%1"/>.*?<w:ind[^>]*w:left="0"[^>]*w:firstLine="${firstLineIndent}"`,
			's',
		),
		numberingXml,
	);
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
			`Bibliography numbering missing or has incorrect indent (expected left 0, firstLine ${firstLineIndent}) / dot format.`,
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

	return [
		resultFromPass(
			'Figure Caption Style',
			hasStyleProperty(
				stylesXml,
				['FigureCaption'],
				captionLineSpacingPattern,
			),
			`FigureCaption style missing or missing single line spacing (${STO_RULES.typography.captionLineSpacingDxa} DXA).`,
		),
		resultFromPass(
			'Table Caption Style',
			hasStyleProperty(
				stylesXml,
				['TableCaption'],
				captionLineSpacingPattern,
			),
			`TableCaption style missing or missing single line spacing (${STO_RULES.typography.captionLineSpacingDxa} DXA).`,
		),
	];
}

function createValidationInput(
	docXml: string,
	stylesXml: string,
	numberingXml: string | null,
): ValidationInput {
	const heading1StyleIds = [getNumberedHeadingStyleId(1), 'Heading1', '1'];
	const heading1StyleRef = `<w:pStyle w:val="(?:${heading1StyleIds.map(escapeRegExp).join('|')})"/>`;
	const structuralHeadingStyleRef = `<w:pStyle w:val="${escapeRegExp(STRUCTURAL_HEADING_STYLE_ID)}"/>`;

	return {
		docXml,
		stylesXml,
		numberingXml,
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
	);

	return [
		...validateHeadingText(input),
		...validateTypography(input),
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
