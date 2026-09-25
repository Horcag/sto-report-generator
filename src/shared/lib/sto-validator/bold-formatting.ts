import { findWordStyleXml } from '../word-style-properties';
import {
	extractWordText,
	getParagraphStyleId,
	getReportBodyElements,
	isParagraphXml,
	isVisibleParagraph,
} from './body-xml';

function boldProperty(propertiesXml: string): boolean | null {
	const tag = /<w:b\b[^>]*\/?\s*>/.exec(propertiesXml)?.[0];
	if (!tag) return null;
	return !/\bw:val="(?:0|false|off)"/i.test(tag);
}

function styleBold(stylesXml: string, styleId: string): boolean | null {
	let currentId: string | null = styleId;
	const visited = new Set<string>();
	while (currentId && !visited.has(currentId)) {
		visited.add(currentId);
		const styleXml = findWordStyleXml(stylesXml, currentId);
		if (!styleXml) break;
		const properties =
			/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(styleXml)?.[1] ?? '';
		const value = boldProperty(properties);
		if (value !== null) return value;
		currentId =
			/<w:basedOn\b[^>]*\bw:val="([^"]+)"/.exec(styleXml)?.[1] ?? null;
	}
	return null;
}

function isOrdinaryBodyStyle(stylesXml: string, styleId: string): boolean {
	if (styleId === 'Normal') return true;
	const styleXml = findWordStyleXml(stylesXml, styleId);
	const styleName = /<w:name\b[^>]*\bw:val="([^"]+)"/.exec(
		styleXml ?? '',
	)?.[1];
	return (
		styleName === 'Normal' || styleName === '+Абзац с отступом 1-ой строки'
	);
}

export function hasBoldOrdinaryBodyText(
	docXml: string,
	stylesXml: string,
): boolean {
	const defaultProperties =
		/<w:rPrDefault\b[^>]*>[\s\S]*?<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(
			stylesXml,
		)?.[1] ?? '';
	return getReportBodyElements(docXml).some(paragraphXml => {
		if (!isParagraphXml(paragraphXml) || !isVisibleParagraph(paragraphXml))
			return false;
		const styleId = getParagraphStyleId(paragraphXml) ?? 'Normal';
		if (!isOrdinaryBodyStyle(stylesXml, styleId)) return false;
		const paragraphBold = styleBold(stylesXml, styleId);
		return (paragraphXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? []).some(
			runXml => {
				if (!extractWordText(runXml).trim()) return false;
				const runProperties =
					/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(runXml)?.[1] ?? '';
				const directBold = boldProperty(runProperties);
				if (directBold !== null) return directBold;
				const characterStyleId =
					/<w:rStyle\b[^>]*\bw:val="([^"]+)"/.exec(
						runProperties,
					)?.[1];
				const characterBold = characterStyleId
					? styleBold(stylesXml, characterStyleId)
					: null;
				return (
					characterBold ??
					paragraphBold ??
					boldProperty(defaultProperties) ??
					false
				);
			},
		);
	});
}
