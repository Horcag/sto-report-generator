import { getSamaraTemplate2022StyleName } from '../config/sto-styles';

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function findWordStyleXml(
	stylesXml: string,
	styleId: string,
): string | null {
	return (
		new RegExp(
			String.raw`<w:style\b(?=[^>]*\bw:styleId="${escapeRegExp(styleId)}")[\s\S]*?<\/w:style>`,
		).exec(stylesXml)?.[0] ?? null
	);
}

function findStyleIdByName(
	stylesXml: string,
	styleName: string,
): string | null {
	for (const match of stylesXml.matchAll(
		/<w:style\b(?=[^>]*\bw:styleId="([^"]+)")[\s\S]*?<\/w:style>/g,
	)) {
		if (
			new RegExp(
				String.raw`<w:name\b[^>]*\bw:val="${escapeRegExp(styleName)}"`,
			).test(match[0])
		) {
			return match[1];
		}
	}
	return null;
}

/** Word may replace custom style IDs while preserving their display names. */
export function resolveWordStyleId(
	stylesXml: string,
	logicalStyleId: string,
): string | null {
	if (findWordStyleXml(stylesXml, logicalStyleId)) {
		return logicalStyleId;
	}
	const nativeName = getSamaraTemplate2022StyleName(logicalStyleId);
	if (nativeName) {
		const nativeStyleId = findStyleIdByName(stylesXml, nativeName);
		if (nativeStyleId) return nativeStyleId;
	}
	const wordNormalizedId = logicalStyleId.startsWith('StoHeading')
		? logicalStyleId.replace('StoHeading', 'STOHeading')
		: null;
	if (wordNormalizedId && findWordStyleXml(stylesXml, wordNormalizedId)) {
		return wordNormalizedId;
	}
	return findStyleIdByName(stylesXml, logicalStyleId);
}

function getBasedOnStyleId(styleXml: string): string | null {
	return /<w:basedOn\b[^>]*\bw:val="([^"]+)"/.exec(styleXml)?.[1] ?? null;
}

function getParagraphProperties(styleXml: string): string {
	return /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(styleXml)?.[1] ?? '';
}

function getRunProperties(styleXml: string): string {
	return /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(styleXml)?.[1] ?? '';
}

function readAttribute(
	xml: string,
	tagName: string,
	attribute: string,
): string | null {
	const tag = new RegExp(`<w:${escapeRegExp(tagName)}\\b[^>]*>`).exec(
		xml,
	)?.[0];
	return tag
		? (new RegExp(`\\bw:${escapeRegExp(attribute)}="([^"]+)"`).exec(
				tag,
			)?.[1] ?? null)
		: null;
}

function visitStyleChain(
	stylesXml: string,
	logicalStyleId: string,
	reader: (styleXml: string) => string | null,
): string | null {
	let styleId = resolveWordStyleId(stylesXml, logicalStyleId);
	const visited = new Set<string>();
	while (styleId && !visited.has(styleId)) {
		visited.add(styleId);
		const styleXml = findWordStyleXml(stylesXml, styleId);
		if (!styleXml) break;
		const value = reader(styleXml);
		if (value !== null) return value;
		styleId = getBasedOnStyleId(styleXml);
	}
	return null;
}

export function getEffectiveParagraphAttribute(
	stylesXml: string,
	logicalStyleId: string,
	tagName: string,
	attribute: string,
): string | null {
	const fromStyle = visitStyleChain(stylesXml, logicalStyleId, styleXml =>
		readAttribute(getParagraphProperties(styleXml), tagName, attribute),
	);
	if (fromStyle !== null) return fromStyle;
	const defaults =
		/<w:pPrDefault\b[^>]*>([\s\S]*?)<\/w:pPrDefault>/.exec(
			stylesXml,
		)?.[1] ?? '';
	const fromDefaults = readAttribute(defaults, tagName, attribute);
	if (fromDefaults !== null) return fromDefaults;
	return tagName === 'spacing' && ['before', 'after'].includes(attribute)
		? '0'
		: null;
}

export function getEffectiveRunAttribute(
	stylesXml: string,
	logicalStyleId: string,
	tagName: string,
	attribute: string,
): string | null {
	const fromStyle = visitStyleChain(stylesXml, logicalStyleId, styleXml =>
		readAttribute(getRunProperties(styleXml), tagName, attribute),
	);
	if (fromStyle !== null) return fromStyle;
	const defaults =
		/<w:rPrDefault\b[^>]*>([\s\S]*?)<\/w:rPrDefault>/.exec(
			stylesXml,
		)?.[1] ?? '';
	return readAttribute(defaults, tagName, attribute);
}

export function hasEffectiveParagraphTag(
	stylesXml: string,
	logicalStyleId: string,
	tagName: string,
): boolean {
	const value = visitStyleChain(stylesXml, logicalStyleId, styleXml => {
		const tag = new RegExp(`<w:${escapeRegExp(tagName)}\\b[^>]*>`).exec(
			getParagraphProperties(styleXml),
		)?.[0];
		if (!tag) return null;
		return /\bw:val="(?:0|false|off)"/.test(tag) ? 'false' : 'true';
	});
	return value === 'true';
}
