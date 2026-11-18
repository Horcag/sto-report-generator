import { STO_RULES } from '../../config';
import {
	findWordStyleXml,
	getEffectiveBodyParagraphAttribute,
} from '../docx/styles';
import { startsWithLowercaseSentence } from '../math/sentence-continuation';
import {
	decodeXmlText,
	extractWordText,
	getBalancedWordElements,
	getBodyElements,
	getParagraphStyleId,
	isParagraphXml,
	isVisibleParagraph,
	paragraphHasDrawing,
	stripAlternateFallbacks,
	stripDrawingContainers,
} from './body-xml';
import { isMathLayoutTable } from './math-layout-table';
import { formulaEndsWithComma } from './math-xml';

export function hasInvalidDirectBodyFormatting(
	docXml: string,
	stylesXml: string,
	numberingXml: string | null,
): boolean {
	let inReferat = false;
	const elements = getBodyElements(docXml);
	return elements.some((paragraphXml, index) => {
		if (!isParagraphXml(paragraphXml) || !isVisibleParagraph(paragraphXml))
			return false;
		const text = extractWordText(paragraphXml).trim();
		const headingText = text.toLocaleUpperCase('ru-RU');
		if (headingText === 'РЕФЕРАТ') inReferat = true;
		if (headingText === 'СОДЕРЖАНИЕ' || headingText === 'ВВЕДЕНИЕ')
			inReferat = false;
		const styleId = getParagraphStyleId(paragraphXml);
		const proseParagraphXml = stripDrawingContainers(paragraphXml);
		const runs = getBalancedWordElements(proseParagraphXml, 'r');
		const isCodeBlock =
			runs.length > 0 && runs.every(run => run.includes('Courier New'));
		const styleName = styleId
			? (/<w:name\b[^>]*\bw:val="([^"]+)"/.exec(
					findWordStyleXml(stylesXml, styleId) ?? '',
				)?.[1] ?? null)
			: null;
		if (
			styleId !== null &&
			styleId !== 'Normal' &&
			styleName !== 'Normal' &&
			styleName !== '+Абзац с отступом 1-ой строки'
		)
			return false;
		const hasOnlyPict =
			/<w:pict\b/.test(stripAlternateFallbacks(paragraphXml)) &&
			text === '';
		if (
			proseParagraphXml.includes('<w:numPr') ||
			paragraphHasDrawing(paragraphXml) ||
			hasOnlyPict ||
			isCodeBlock ||
			(inReferat && proseParagraphXml.includes('<w:caps')) ||
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
		const previous = elements[index - 1];
		const visibleText = [
			...proseParagraphXml.matchAll(
				/<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g,
			),
		]
			.map(match =>
				match[1] === undefined ? '\uFFFC' : decodeXmlText(match[1]),
			)
			.join('');
		const continuesFormulaSentence =
			startsWithLowercaseSentence(visibleText) &&
			previous !== undefined &&
			isMathLayoutTable(previous, stylesXml) &&
			formulaEndsWithComma(previous, docXml);
		const runSpacing = [
			...proseParagraphXml.matchAll(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/g),
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
				continuesFormulaSentence &&
					effective('ind', 'firstLine') === '0'
					? 0
					: STO_RULES.typography.firstLineIndentDxa,
			) ||
			effective('ind', 'firstLine') === null ||
			effective('ind', 'hanging') !== null ||
			runSpacing.some(tag => {
				const value = /\bw:val="([^"]+)"/.exec(tag)?.[1] ?? null;
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
