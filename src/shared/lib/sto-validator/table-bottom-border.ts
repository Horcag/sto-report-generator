import { JSDOM } from 'jsdom';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children = (element: Element | undefined, name: string): Element[] =>
	element
		? [...element.children].filter(
				item => item.namespaceURI === NS && item.localName === name,
			)
		: [];
const child = (element: Element | undefined, name: string) =>
	children(element, name)[0];
const attribute = (element: Element | undefined, name: string) =>
	element?.getAttributeNS(NS, name) ?? null;
const bottom = (properties: Element | undefined, borders: string) =>
	attribute(child(child(properties, borders), 'bottom'), 'val');
const visible = (value: string | null) =>
	value !== null && !['nil', 'none'].includes(value);

/** A continuation must not acquire a visible bottom from cells, table properties or styles.
 * Conditional style borders without a direct override require layout resolution and fail closed.
 */
export function hasVisibleOrUnverifiedTableBottom(
	tableXml: string,
	stylesXml: string,
	namespaceContext = tableXml,
): boolean {
	const namespaces = new Map([['xmlns:w', `"${NS}"`]]);
	for (const match of namespaceContext.matchAll(
		/\b(xmlns(?::[\w.-]+)?)=("[^"]*"|'[^']*')/g,
	))
		namespaces.set(match[1], match[2]);
	const declarations = [...namespaces]
		.map(([name, value]) => `${name}=${value}`)
		.join(' ');
	const dom = new JSDOM(
		`<root ${declarations}>${stylesXml.replace(/<\?xml[^?]*\?>/g, '')}${tableXml}</root>`,
		{ contentType: 'text/xml' },
	);
	try {
		const root = dom.window.document.documentElement;
		const table = root.getElementsByTagNameNS(NS, 'tbl')[0];
		if (!table) return false;
		const properties = child(table, 'tblPr');
		const styleMap = new Map(
			[...root.getElementsByTagNameNS(NS, 'style')].map(style => [
				attribute(style, 'styleId'),
				style,
			]),
		);
		const styles: Element[] = [];
		const visited = new Set<string>();
		let id = attribute(child(properties, 'tblStyle'), 'val');
		while (id && !visited.has(id)) {
			visited.add(id);
			const style = styleMap.get(id);
			if (!style) return true;
			styles.push(style);
			id = attribute(child(style, 'basedOn'), 'val');
		}
		if (id) return true;
		const inherited = (kind: 'tblPr' | 'tcPr', borders: string) => {
			for (const style of styles) {
				const value =
					bottom(child(style, kind), borders) ??
					bottom(
						child(
							children(style, 'tblStylePr').find(
								item =>
									attribute(item, 'type') === 'wholeTable',
							),
							kind,
						),
						borders,
					);
				if (value !== null) return value;
			}
			return null;
		};
		const conditional = (kind: 'tblPr' | 'tcPr', borders: string) =>
			styles.some(style =>
				children(style, 'tblStylePr').some(
					condition =>
						attribute(condition, 'type') !== 'wholeTable' &&
						bottom(child(condition, kind), borders) !== null,
				),
			);
		const rows = children(table, 'tr');
		const lastRow = rows.at(-1);
		const directTable =
			bottom(child(lastRow, 'tblPrEx'), 'tblBorders') ??
			bottom(properties, 'tblBorders');
		if (visible(directTable ?? inherited('tblPr', 'tblBorders')))
			return true;
		if (directTable === null && conditional('tblPr', 'tblBorders'))
			return true;
		return children(lastRow, 'tc').some(cell => {
			const direct = bottom(child(cell, 'tcPr'), 'tcBorders');
			if (direct !== null) return visible(direct);
			if (conditional('tcPr', 'tcBorders')) return true;
			return visible(inherited('tcPr', 'tcBorders'));
		});
	} finally {
		dom.window.close();
	}
}
