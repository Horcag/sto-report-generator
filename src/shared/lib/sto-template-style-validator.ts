import {
	STO_RULES,
	STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	STRUCTURAL_HEADING_STYLE_ID,
} from '../config';
import type { ValidationResult } from './sto-validator';
import {
	getEffectiveParagraphAttribute,
	getEffectiveRunAttribute,
	hasEffectiveParagraphTag,
	resolveWordStyleId,
} from './word-style-properties';

const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value: string): string {
	return value.replaceAll(REGEXP_SPECIAL_CHARS, String.raw`\$&`);
}

function findStyleXml(stylesXml: string, styleId: string): string | null {
	const escapedStyleId = escapeRegExp(styleId);
	return (
		new RegExp(
			String.raw`<w:style\b(?=[^>]*\bw:styleId="${escapedStyleId}")[\s\S]*?<\/w:style>`,
		).exec(stylesXml)?.[0] ?? null
	);
}

function getBasedOnStyleId(styleXml: string): string | null {
	return (
		/<w:basedOn\b[^>]*\bw:val="([^"]+)"[^>]*\/>/.exec(styleXml)?.[1] ?? null
	);
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
		if (propertyPattern.test(styleXml)) {
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

function hasStyleProperty(
	stylesXml: string,
	styleIds: readonly string[],
	propertyPattern: RegExp,
): boolean {
	return expandStyleIds(stylesXml, styleIds).some(styleId => {
		const styleXml = findStyleXml(stylesXml, styleId);
		return styleXml ? propertyPattern.test(styleXml) : false;
	});
}

function check(
	check: string,
	passed: boolean,
	error: string,
): ValidationResult {
	return passed ? { check, passed: true } : { check, passed: false, error };
}

function hasSpacing(
	stylesXml: string,
	styleIds: readonly string[],
	attributes: Record<string, number>,
): boolean {
	return styleIds.some(
		styleId =>
			resolveWordStyleId(stylesXml, styleId) !== null &&
			Object.entries(attributes).every(
				([attribute, value]) =>
					getEffectiveParagraphAttribute(
						stylesXml,
						styleId,
						'spacing',
						attribute.replace(/^w:/, ''),
					) === String(value),
			),
	);
}

function findHeadingNumberingLevel(
	stylesXml: string,
	numberingXml: string | null,
	styleIds: readonly string[],
): string | null {
	if (numberingXml === null) {
		return null;
	}

	for (const styleId of expandStyleIds(stylesXml, styleIds)) {
		const styleXml = findStyleXml(stylesXml, styleId);
		if (!styleXml) continue;
		const numId = /<w:numId\b[^>]*\bw:val="([^"]+)"/.exec(styleXml)?.[1];
		const level = /<w:ilvl\b[^>]*\bw:val="([^"]+)"/.exec(styleXml)?.[1];
		if (numId === undefined) continue;

		const numXml = new RegExp(
			`<w:num\\b(?=[^>]*\\bw:numId="${escapeRegExp(numId)}")[\\s\\S]*?<\\/w:num>`,
		).exec(numberingXml)?.[0];
		const abstractNumId = numXml
			? /<w:abstractNumId\b[^>]*\bw:val="([^"]+)"/.exec(numXml)?.[1]
			: undefined;
		if (abstractNumId === undefined) continue;

		const abstractNumXml = new RegExp(
			`<w:abstractNum\\b(?=[^>]*\\bw:abstractNumId="${escapeRegExp(abstractNumId)}")[\\s\\S]*?<\\/w:abstractNum>`,
		).exec(numberingXml)?.[0];
		if (!abstractNumXml) continue;
		const levels = abstractNumXml.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? [];
		const matchedLevel = levels.find(levelXml =>
			level !== undefined
				? new RegExp(`\\bw:ilvl="${escapeRegExp(level)}"`).test(
						levelXml,
					)
				: new RegExp(
						`<w:pStyle\\b[^>]*\\bw:val="${escapeRegExp(styleId)}"`,
					).test(levelXml),
		);
		if (matchedLevel) return matchedLevel;
	}

	return null;
}

export function validateTemplateStyleConformance(
	stylesXml: string,
	numberingXml: string | null,
	heading1StyleIds: readonly string[],
): ValidationResult[] {
	const captionLine = STO_RULES.typography.captionLineSpacingDxa;
	const structuralHeadingIds = [
		STRUCTURAL_HEADING_STYLE_ID,
		STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	];
	const headingNumberingLevel = findHeadingNumberingLevel(
		stylesXml,
		numberingXml,
		heading1StyleIds,
	);

	return [
		check(
			'Numbered Heading Template Style',
			hasSpacing(stylesXml, heading1StyleIds, {
				'w:before': 0,
				'w:after': 120,
				'w:line': STO_RULES.typography.normalLineSpacingDxa,
			}) &&
				heading1StyleIds.some(
					styleId =>
						getEffectiveParagraphAttribute(
							stylesXml,
							styleId,
							'ind',
							'firstLine',
						) === '709' &&
						hasEffectiveParagraphTag(
							stylesXml,
							styleId,
							'keepNext',
						) &&
						hasEffectiveParagraphTag(
							stylesXml,
							styleId,
							'keepLines',
						),
				) &&
				hasStyleProperty(stylesXml, heading1StyleIds, /<w:numPr\b/),
			'Heading 1 must preserve DOTM spacing, first-line indent, keep flags, and style-linked numbering.',
		),
		check(
			'Numbered Heading Effective Indent',
			headingNumberingLevel !== null &&
				/<w:ind\b(?=[^>]*w:left="0")(?=[^>]*w:firstLine="709")/.test(
					headingNumberingLevel,
				),
			'Heading 1 numbering must preserve the DOTM effective left=0 and firstLine=709 indent.',
		),
		check(
			'Numbered Heading Alignment',
			!hasStyleProperty(
				stylesXml,
				heading1StyleIds,
				/<w:jc\b[^>]*w:val="center"[^>]*\/>/,
			),
			'Numbered headings (Heading1) must not be centered.',
		),
		check(
			'Structural Heading Alignment',
			structuralHeadingIds.every(
				styleId =>
					getEffectiveParagraphAttribute(
						stylesXml,
						styleId,
						'jc',
						'val',
					) === 'center',
			),
			'Structural headings must be centered.',
		),
		check(
			'Heading 1 Page Break',
			hasStylePropertyOrInherited(
				stylesXml,
				heading1StyleIds,
				/<w:pageBreakBefore\b/,
			),
			'Heading 1 must have a pageBreakBefore.',
		),
		check(
			'Structural Heading Page Break',
			structuralHeadingIds.every(styleId =>
				hasStylePropertyOrInherited(
					stylesXml,
					[styleId],
					/<w:pageBreakBefore\b/,
				),
			),
			'Structural headings must have a pageBreakBefore.',
		),
		check(
			'Structural Heading Spacing',
			hasSpacing(stylesXml, [STRUCTURAL_HEADING_STYLE_ID], {
				'w:before': 0,
				'w:after': 120,
				'w:line': STO_RULES.typography.normalLineSpacingDxa,
			}) &&
				hasSpacing(stylesXml, [STRUCTURAL_HEADING_NO_TOC_STYLE_ID], {
					'w:before': 0,
					'w:after': 240,
					'w:line': captionLine,
				}) &&
				structuralHeadingIds.every(
					styleId =>
						!hasStylePropertyOrInherited(
							stylesXml,
							[styleId],
							/<w:keepNext\b/,
						),
				),
			'Structural headings must preserve DOTM spacing and must not keep the following paragraph on the same page.',
		),
		check(
			'Title Page Base Style',
			hasSpacing(stylesXml, ['TitlePageText'], {
				'w:before': 0,
				'w:after': 0,
				'w:line': captionLine,
			}) &&
				getEffectiveRunAttribute(
					stylesXml,
					'TitlePageText',
					'sz',
					'val',
				) === '28',
			'TitlePageText must keep the DOTM 14pt, single-line base style.',
		),
		check(
			'Figure Caption Style',
			hasStyleProperty(
				stylesXml,
				['FigureCaption'],
				/<w:jc\b[^>]*w:val="center"[^>]*\/>/,
			) &&
				hasStyleProperty(
					stylesXml,
					['FigureCaption'],
					/<w:ind\b[^>]*w:firstLine="0"/,
				) &&
				hasSpacing(stylesXml, ['FigureCaption'], {
					'w:before': 120,
					'w:after': 240,
					'w:line': captionLine,
				}) &&
				hasStyleProperty(
					stylesXml,
					['FigureCaption'],
					/<w:keepLines\b/,
				),
			`FigureCaption must be centered, have no first-line indent, 6pt/12pt single spacing, and keep lines together.`,
		),
		check(
			'Table Caption Style',
			hasStyleProperty(
				stylesXml,
				['TableCaption'],
				/<w:jc\b[^>]*w:val="left"[^>]*\/>/,
			) &&
				hasStyleProperty(
					stylesXml,
					['TableCaption'],
					/<w:ind\b[^>]*w:firstLine="0"/,
				) &&
				hasSpacing(stylesXml, ['TableCaption'], {
					'w:before': 120,
					'w:after': 120,
					'w:line': captionLine,
				}) &&
				hasStyleProperty(
					stylesXml,
					['TableCaption'],
					/<w:keepNext\b/,
				) &&
				hasStyleProperty(stylesXml, ['TableCaption'], /<w:keepLines\b/),
			'TableCaption must be left-aligned, have no first-line indent, 6pt/6pt single spacing, keep with the table, and keep lines together.',
		),
		check(
			'Table Text Style',
			hasStyleProperty(
				stylesXml,
				['TableText'],
				/<w:ind\b[^>]*w:firstLine="0"/,
			) &&
				hasSpacing(stylesXml, ['TableText'], { 'w:line': captionLine }),
			`TableText style must have no first-line indent and use single line spacing (${captionLine} DXA).`,
		),
	];
}
