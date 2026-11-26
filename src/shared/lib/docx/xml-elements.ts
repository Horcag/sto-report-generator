const XML_IGNORED_SEGMENT = '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>';
const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

export const WORD_ML_NS =
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const MARKUP_COMPATIBILITY_NS =
	'http://schemas.openxmlformats.org/markup-compatibility/2006';

export interface XmlElementRange {
	name: string;
	start: number;
	end: number;
}

function escapeRegExp(value: string): string {
	return value.replaceAll(REGEXP_SPECIAL_CHARS, String.raw`\$&`);
}

function buildQualifiedAlternation(qualifiedNames: string): string {
	const parts = qualifiedNames
		.split('|')
		.map(name => name.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		throw new Error('Expected at least one qualified XML element name.');
	}
	return parts.map(escapeRegExp).join('|');
}

/**
 * Scan XML sequentially and return outer-balanced ranges for any of the given
 * qualified element names (e.g. `"w:p|w:tbl"` or `"mc:Fallback"`), skipping
 * XML comments, CDATA blocks, and nested occurrences inside matched elements.
 */
export function findBalancedXmlElementRanges(
	xml: string,
	qualifiedNames: string,
): XmlElementRange[] {
	const alternation = buildQualifiedAlternation(qualifiedNames);
	const openings = new RegExp(
		`${XML_IGNORED_SEGMENT}|<(${alternation})\\b[^>]*>`,
		'g',
	);
	const ranges: XmlElementRange[] = [];
	let opening: RegExpExecArray | null;

	while ((opening = openings.exec(xml))) {
		const matchedName = opening[1];
		if (!matchedName) continue;
		const start = opening.index;
		if (opening[0].endsWith('/>')) {
			ranges.push({
				name: matchedName,
				start,
				end: openings.lastIndex,
			});
			continue;
		}
		const tags = new RegExp(
			`${XML_IGNORED_SEGMENT}|</?${escapeRegExp(matchedName)}\\b[^>]*>`,
			'g',
		);
		tags.lastIndex = openings.lastIndex;
		let depth = 1;
		let tag: RegExpExecArray | null;
		while (depth && (tag = tags.exec(xml))) {
			if (tag[0].startsWith('<!')) continue;
			if (tag[0].startsWith('</')) depth--;
			else if (!tag[0].endsWith('/>')) depth++;
		}
		if (depth) {
			throw new Error(`Unclosed Word XML element ${matchedName}.`);
		}
		ranges.push({
			name: matchedName,
			start,
			end: tags.lastIndex,
		});
		openings.lastIndex = tags.lastIndex;
	}

	return ranges;
}

/** Extract top-level balanced XML strings for the specified qualified tag alternation. */
export function getBalancedXmlElements(
	xml: string,
	qualifiedNames: string,
): string[] {
	return findBalancedXmlElementRanges(xml, qualifiedNames).map(range =>
		xml.slice(range.start, range.end),
	);
}

/** Remove all balanced XML subtrees matching any of the given qualified element names. */
export function stripXmlElements(xml: string, qualifiedNames: string): string {
	const ranges = findBalancedXmlElementRanges(xml, qualifiedNames);
	if (ranges.length === 0) return xml;
	let cursor = 0;
	let result = '';
	for (const range of ranges) {
		result += xml.slice(cursor, range.start);
		cursor = range.end;
	}
	return result + xml.slice(cursor);
}

/** Remove alternate-content fallback subtrees so Word-saved VML duplicates are ignored. */
export function stripAlternateFallbacks(xml: string): string {
	return stripXmlElements(xml, 'mc:Fallback');
}

/**
 * Strip fallback, drawing, VML picture, and textbox subtrees so outer body
 * validators inspect only report prose and direct paragraph properties.
 */
export function stripDrawingContainers(xml: string): string {
	return stripXmlElements(xml, 'mc:Fallback|w:drawing|w:pict|w:txbxContent');
}

/**
 * Strip fallback and textbox contents while preserving outer `<w:drawing>` markers
 * so layout validators still detect uncentered figure paragraphs without truncating on nested `</w:p>`.
 */
export function stripTextboxAndFallbackContainers(xml: string): string {
	return stripXmlElements(xml, 'mc:Fallback|w:txbxContent');
}

/** Extract the inner XML of the first balanced `<w:pPr>` belonging to an outer paragraph, style, or numbering level. */
export function getParagraphPropertiesContent(xml: string): string {
	const outerXml = stripDrawingContainers(xml);
	const properties = getBalancedXmlElements(outerXml, 'w:pPr')[0];
	if (!properties || properties.endsWith('/>')) return '';
	const openEnd = properties.indexOf('>');
	const closeStart = properties.lastIndexOf('</w:pPr>');
	if (openEnd < 0 || closeStart <= openEnd) return '';
	return properties.slice(openEnd + 1, closeStart);
}

/** Test whether a DOM element lies inside any ancestor with the specified `(namespaceURI, localName)` pairs. */
export function hasXmlAncestor(
	element: Element | null,
	ancestors: ReadonlyArray<readonly [string, string]>,
	boundary: Element | null = null,
): boolean {
	for (
		let current = element?.parentElement ?? null;
		current && current !== boundary;
		current = current.parentElement
	) {
		if (
			ancestors.some(
				([namespaceUri, localName]) =>
					current.namespaceURI === namespaceUri &&
					current.localName === localName,
			)
		) {
			return true;
		}
	}
	return false;
}

export const NON_BODY_PROSE_ANCESTORS: ReadonlyArray<
	readonly [string, string]
> = [
	[MARKUP_COMPATIBILITY_NS, 'Fallback'],
	[WORD_ML_NS, 'txbxContent'],
	[WORD_ML_NS, 'drawing'],
	[WORD_ML_NS, 'pict'],
];

/** Return direct child elements with the given namespace and local name. */
export function directXmlChildren(
	parent: Element | undefined | null,
	namespaceUri: string,
	localName: string,
): Element[] {
	return parent
		? [...parent.children].filter(
				child =>
					child.namespaceURI === namespaceUri &&
					child.localName === localName,
			)
		: [];
}
