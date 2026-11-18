import { findWordStyleXml, resolveWordStyleId } from '../docx/styles';
import {
	extractWordText,
	getAllDocumentParagraphs,
	getBalancedWordElements,
	getParagraphStyleId,
} from './body-xml';

function hasRunLevelTab(paragraphXml: string): boolean {
	const runs = getBalancedWordElements(paragraphXml, 'r');
	return runs.some(runXml => /<w:tab\b/.test(runXml));
}

function isAllowedLayoutTabParagraph(
	paragraphXml: string,
	stylesXml: string,
): boolean {
	const styleId = getParagraphStyleId(paragraphXml);
	if (!styleId) return false;
	const layoutStyleIds = ['TitlePageText', 'TOC1', 'TOC2', 'TOC3', 'TOC4'];
	if (
		layoutStyleIds.some(
			layoutStyleId =>
				styleId === resolveWordStyleId(stylesXml, layoutStyleId),
		)
	)
		return true;

	const styleXml = findWordStyleXml(stylesXml, styleId);
	const styleName = styleXml
		? /<w:name\b[^>]*\bw:val="([^"]+)"/.exec(styleXml)?.[1]
		: null;
	return styleName ? /^toc\s+\d+$/i.test(styleName) : false;
}

export function hasForbiddenTabCharacters(
	docXml: string,
	stylesXml: string,
): boolean {
	const paragraphs = getAllDocumentParagraphs(docXml, {
		stripDrawings: true,
	});
	return paragraphs.some(
		paragraphXml =>
			(hasRunLevelTab(paragraphXml) ||
				extractWordText(paragraphXml).includes('\t')) &&
			!isAllowedLayoutTabParagraph(paragraphXml, stylesXml),
	);
}
