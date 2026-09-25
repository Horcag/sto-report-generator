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

function paragraphProperties(xml: string): string {
	return /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
}

/** Resolve one paragraph property in Word's direct, numbering, style, defaults order. */
export function getEffectiveBodyParagraphAttribute(
	paragraphXml: string,
	stylesXml: string,
	numberingXml: string | null,
	styleId: string,
	tagName: string,
	attribute: string,
): string | null {
	const directProperties = paragraphProperties(paragraphXml);
	const competingIndent =
		attribute === 'firstLine'
			? 'hanging'
			: attribute === 'hanging'
				? 'firstLine'
				: null;
	if (
		tagName === 'ind' &&
		competingIndent &&
		readAttribute(directProperties, 'ind', competingIndent) !== null
	)
		return null;
	const direct = readAttribute(directProperties, tagName, attribute);
	if (direct !== null) return direct;

	const numberProperty = (properties: string, name: string) =>
		readAttribute(
			/<w:numPr\b[^>]*>([\s\S]*?)<\/w:numPr>/.exec(properties)?.[1] ?? '',
			name,
			'val',
		);
	const styleNumber = visitStyleChain(stylesXml, styleId, styleXml =>
		numberProperty(getParagraphProperties(styleXml), 'numId'),
	);
	const numId = numberProperty(directProperties, 'numId') ?? styleNumber;
	if (numberingXml && numId && numId !== '0') {
		const numXml = new RegExp(
			String.raw`<w:num\b(?=[^>]*\bw:numId="${escapeRegExp(numId)}")[\s\S]*?<\/w:num>`,
		).exec(numberingXml)?.[0];
		const abstractId =
			numXml && readAttribute(numXml, 'abstractNumId', 'val');
		const abstractXml =
			abstractId &&
			new RegExp(
				String.raw`<w:abstractNum\b(?=[^>]*\bw:abstractNumId="${escapeRegExp(abstractId)}")[\s\S]*?<\/w:abstractNum>`,
			).exec(numberingXml)?.[0];
		const level =
			numberProperty(directProperties, 'ilvl') ??
			visitStyleChain(stylesXml, styleId, styleXml =>
				numberProperty(getParagraphProperties(styleXml), 'ilvl'),
			) ??
			'0';
		const levelXml =
			abstractXml &&
			new RegExp(
				String.raw`<w:lvl\b(?=[^>]*\bw:ilvl="${escapeRegExp(level)}")[\s\S]*?<\/w:lvl>`,
			).exec(abstractXml)?.[0];
		const overrideXml =
			numXml &&
			new RegExp(
				String.raw`<w:lvlOverride\b(?=[^>]*\bw:ilvl="${escapeRegExp(level)}")[\s\S]*?<\/w:lvlOverride>`,
			).exec(numXml)?.[0];
		const overrideProperties = paragraphProperties(overrideXml ?? '');
		const levelProperties = paragraphProperties(levelXml ?? '');
		const overrideValue = readAttribute(
			overrideProperties,
			tagName,
			attribute,
		);
		if (overrideValue !== null) return overrideValue;
		if (
			tagName === 'ind' &&
			competingIndent &&
			readAttribute(overrideProperties, 'ind', competingIndent) !== null
		)
			return null;
		const levelValue = readAttribute(levelProperties, tagName, attribute);
		if (levelValue !== null) return levelValue;
		if (
			tagName === 'ind' &&
			competingIndent &&
			readAttribute(levelProperties, 'ind', competingIndent) !== null
		)
			return null;
	}
	if (tagName === 'ind' && competingIndent) {
		const fromStyle = visitStyleChain(stylesXml, styleId, styleXml => {
			const properties = getParagraphProperties(styleXml);
			return (
				readAttribute(properties, 'ind', attribute) ??
				(readAttribute(properties, 'ind', competingIndent) !== null
					? ''
					: null)
			);
		});
		if (fromStyle !== null) return fromStyle || null;
		const defaults =
			/<w:pPrDefault\b[^>]*>([\s\S]*?)<\/w:pPrDefault>/.exec(
				stylesXml,
			)?.[1] ?? '';
		return readAttribute(defaults, 'ind', attribute);
	}
	return getEffectiveParagraphAttribute(
		stylesXml,
		styleId,
		tagName,
		attribute,
	);
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
