import { STO_RULES } from '../../config';

export function hasExpectedDefaultFont(stylesXml: string): boolean {
	const font = STO_RULES.typography.fontFamily.replace(
		/[.*+?^${}()|[\]\\]/g,
		String.raw`\$&`,
	);
	return new RegExp(
		String.raw`<w:rFonts\b[^>]*(?:w:ascii="${font}"|w:hAnsi="${font}")`,
	).test(stylesXml);
}

export function hasExpectedDefaultFontSize(
	stylesXml: string,
	strictSto = false,
): boolean {
	return new RegExp(
		String.raw`<w:sz\b[^>]*w:val="${strictSto ? '2[4-8]' : STO_RULES.typography.fontSizeHalfPoints}"`,
	).test(stylesXml);
}
