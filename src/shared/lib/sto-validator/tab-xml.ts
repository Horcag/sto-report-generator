import { findWordStyleXml, resolveWordStyleId } from '../docx/styles';
import { extractWordText, getParagraphStyleId } from './body-xml';

function hasRunLevelTab(paragraphXml: string): boolean {
	const runs = paragraphXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
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
	const paragraphs = docXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
	return paragraphs.some(
		paragraphXml =>
			(hasRunLevelTab(paragraphXml) ||
				extractWordText(paragraphXml).includes('\t')) &&
			!isAllowedLayoutTabParagraph(paragraphXml, stylesXml),
	);
}
