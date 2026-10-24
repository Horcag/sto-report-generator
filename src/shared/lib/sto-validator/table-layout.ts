import { JSDOM } from 'jsdom';

import { STO_RULES } from '../../config';
import type { ValidationResult } from '../sto-validator';
import { isMathLayoutTable } from './math-layout-table';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function children(element: Element | undefined, name: string): Element[] {
	return element
		? [...element.children].filter(
				child => child.namespaceURI === NS && child.localName === name,
			)
		: [];
}
function child(
	element: Element | undefined,
	name: string,
): Element | undefined {
	return children(element, name)[0];
}
function attr(element: Element | undefined, name: string): string | null {
	return element?.getAttributeNS(NS, name) ?? null;
}
function enabled(element: Element | undefined): boolean {
	return (
		element !== undefined &&
		!['0', 'false', 'off'].includes(attr(element, 'val') ?? '')
	);
}
function alignment(properties: Element | undefined): string | null {
	return attr(child(properties, 'jc'), 'val');
}
function parse(xml: string): { root: Element; close: () => void } {
	const dom = new JSDOM(
		`<root xmlns:w="${NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml.replace(/<\?xml[^?]*\?>/g, '')}</root>`,
		{ contentType: 'text/xml' },
	);
	return {
		root: dom.window.document.documentElement,
		close: () => dom.window.close(),
	};
}
function styleResolver(root: Element): (id: string | null) => Element[] {
	const styles = new Map(
		[...root.getElementsByTagNameNS(NS, 'style')].map(style => [
			attr(style, 'styleId'),
			style,
		]),
	);
	const cache = new Map<string | null, Element[]>();
	return id => {
		const cached = cache.get(id);
		if (cached) return cached;
		const chain: Element[] = [];
		const seen = new Set<string>();
		let current = id;
		while (current && !seen.has(current)) {
			seen.add(current);
			const style = styles.get(current);
			if (!style) break;
			chain.push(style);
			current = attr(child(style, 'basedOn'), 'val');
		}
		cache.set(id, chain);
		return chain;
	};
}
function reportTables(root: Element): Element[] {
	const body = root.getElementsByTagNameNS(NS, 'body')[0];
	if (!body) return [];
	const elements = [...body.children];
	const start = elements.findIndex(
		element =>
			element.namespaceURI === NS &&
			element.localName === 'p' &&
			[...element.getElementsByTagNameNS(NS, 't')]
				.map(text => text.textContent ?? '')
				.join('')
				.trim()
				.toLocaleUpperCase('ru-RU') === 'РЕФЕРАТ',
	);
	const tables: Element[] = [];
	for (const element of elements.slice(Math.max(start, 0))) {
		if (element.namespaceURI !== NS || element.localName !== 'tbl')
			continue;
		tables.push(element, ...element.getElementsByTagNameNS(NS, 'tbl'));
	}
	return tables;
}
function lookEnabled(table: Element, name: string, mask: number): boolean {
	const look = child(child(table, 'tblPr'), 'tblLook');
	const explicit = attr(look, name);
	if (explicit !== null) return !['0', 'false', 'off'].includes(explicit);
	return (Number.parseInt(attr(look, 'val') ?? '0', 16) & mask) !== 0;
}

function effectiveAlignment(
	paragraph: Element,
	cell: Element,
	row: Element,
	table: Element,
	resolveStyle: (id: string | null) => Element[],
	defaults: Element,
	rowIndex: number,
	cellStart: number,
	cellEnd: number,
	columnCount: number,
): string {
	const properties = child(paragraph, 'pPr');
	const direct = alignment(properties);
	if (direct !== null) return direct;
	const defaultStyle = [...defaults.getElementsByTagNameNS(NS, 'style')].find(
		style => attr(style, 'type') === 'paragraph' && enabledDefault(style),
	);
	const paragraphStyles = resolveStyle(
		attr(child(properties, 'pStyle'), 'val') ??
			attr(defaultStyle, 'styleId'),
	);
	for (const style of paragraphStyles) {
		const value = alignment(child(style, 'pPr'));
		if (value !== null) return value;
	}
	const rows = children(table, 'tr');
	const conditions = [
		[
			'firstCol',
			cellStart === 0 && lookEnabled(table, 'firstColumn', 0x80),
		],
		[
			'lastCol',
			cellEnd === columnCount && lookEnabled(table, 'lastColumn', 0x100),
		],
		[
			'firstRow',
			(rowIndex === 0 ||
				rows
					.slice(0, rowIndex + 1)
					.every(item =>
						enabled(child(child(item, 'trPr'), 'tblHeader')),
					)) &&
				lookEnabled(table, 'firstRow', 0x20),
		],
		[
			'lastRow',
			rowIndex === rows.length - 1 && lookEnabled(table, 'lastRow', 0x40),
		],
	] as const;
	const cornerConditions = [
		['nwCell', conditions[2][1] && conditions[0][1]],
		['neCell', conditions[2][1] && conditions[1][1]],
		['swCell', conditions[3][1] && conditions[0][1]],
		['seCell', conditions[3][1] && conditions[1][1]],
	] as const;
	const tableStyles = resolveStyle(
		attr(child(child(table, 'tblPr'), 'tblStyle'), 'val'),
	);
	// Conditional formatting overrides the table style's ordinary paragraph properties.
	for (const [condition, applies] of [
		...conditions,
		...cornerConditions,
	].reverse()) {
		const propertyName =
			condition === 'firstCol'
				? 'firstColumn'
				: condition === 'lastCol'
					? 'lastColumn'
					: ((
							{
								nwCell: 'firstRowFirstColumn',
								neCell: 'firstRowLastColumn',
								swCell: 'lastRowFirstColumn',
								seCell: 'lastRowLastColumn',
							} as Record<string, string>
						)[condition] ?? condition);
		const conditionalProperties = [
			child(child(cell, 'tcPr'), 'cnfStyle'),
			child(child(row, 'trPr'), 'cnfStyle'),
			child(properties, 'cnfStyle'),
		];
		let explicit: string | null = null;
		for (const conditional of conditionalProperties) {
			explicit = attr(conditional, propertyName);
			if (explicit !== null) break;
			const bits = attr(conditional, 'val');
			if (bits && /^[01]{12}$/.test(bits)) {
				explicit =
					bits[
						[
							'firstRow',
							'lastRow',
							'firstColumn',
							'lastColumn',
							'oddVBand',
							'evenVBand',
							'oddHBand',
							'evenHBand',
							'firstRowFirstColumn',
							'firstRowLastColumn',
							'lastRowFirstColumn',
							'lastRowLastColumn',
						].indexOf(propertyName)
					];
				break;
			}
		}

		if (
			explicit === null
				? !applies
				: ['0', 'false', 'off'].includes(explicit)
		)
			continue;
		for (const style of tableStyles) {
			const value = alignment(
				child(
					children(style, 'tblStylePr').find(
						item => attr(item, 'type') === condition,
					),
					'pPr',
				),
			);
			if (value !== null) return value;
		}
	}
	// Band sizes and merged-cell positions need a fuller layout model. Do not silently
	// approve a heading whose alignment depends on an unresolved band condition.
	for (const style of tableStyles) {
		for (const condition of children(style, 'tblStylePr')) {
			const type = attr(condition, 'type') ?? '';
			if (alignment(child(condition, 'pPr')) === null) continue;
			if (
				(/^band[12]Horz$/.test(type) &&
					!lookEnabled(table, 'noHBand', 0x200)) ||
				(/^band[12]Vert$/.test(type) &&
					!lookEnabled(table, 'noVBand', 0x400))
			)
				return 'unverified conditional band alignment';
		}
	}

	for (const style of tableStyles) {
		const value =
			alignment(child(style, 'pPr')) ??
			alignment(
				child(
					children(style, 'tblStylePr').find(
						item => attr(item, 'type') === 'wholeTable',
					),
					'pPr',
				),
			);
		if (value !== null) return value;
	}
	return (
		alignment(
			child(
				child(child(defaults, 'styles'), 'docDefaults'),
				'pPrDefault',
			)?.getElementsByTagNameNS(NS, 'pPr')[0],
		) ?? 'left'
	);
}
function enabledDefault(style: Element): boolean {
	return ['1', 'true', 'on'].includes(attr(style, 'default') ?? '');
}
function integerProperty(
	properties: Element | undefined,
	name: string,
	fallback: number,
): number {
	const element = child(properties, name);
	return element ? Number(attr(element, 'val')) : fallback;
}

/** Validate semantic column headings and structural invariants, without imposing body-cell alignment or inner borders. */
export function validateTableLayout(
	docXml: string,
	stylesXml = '',
): ValidationResult[] {
	const failures: Record<string, string[]> = {
		'Table Header Horizontal Alignment': [],
		'Table Grid Structure': [],
		'Table Header Repeat Order': [],
	};
	const styles = parse(stylesXml);
	const document = parse(docXml);
	try {
		const defaults = styles.root;
		const resolveStyle = styleResolver(defaults);
		reportTables(document.root).forEach((table, tableIndex) => {
			if (isMathLayoutTable(table.outerHTML)) return;
			const rows = children(table, 'tr');
			const grid = children(child(table, 'tblGrid'), 'gridCol');
			let headerEnded = false;
			let repeatEnded = false;
			rows.forEach((row, rowIndex) => {
				const repeat = enabled(child(child(row, 'trPr'), 'tblHeader'));
				const location = `word/document.xml: table ${tableIndex + 1}, row ${rowIndex + 1}`;
				if (repeat && repeatEnded)
					failures['Table Header Repeat Order'].push(location);
				if (!repeat) repeatEnded = true;
				const isHeader = rowIndex === 0 || (!headerEnded && repeat);
				if (!isHeader) headerEnded = true;
				const before = integerProperty(
					child(row, 'trPr'),
					'gridBefore',
					0,
				);
				const after = integerProperty(
					child(row, 'trPr'),
					'gridAfter',
					0,
				);
				let cursor = before;
				let invalidGrid =
					!Number.isInteger(before) ||
					before < 0 ||
					!Number.isInteger(after) ||
					after < 0;
				for (const [cellIndex, cell] of children(row, 'tc').entries()) {
					const span = integerProperty(
						child(cell, 'tcPr'),
						'gridSpan',
						1,
					);
					if (!Number.isInteger(span) || span < 1) invalidGrid = true;
					if (isHeader) {
						for (const paragraph of children(cell, 'p')) {
							if (
								!paragraph.textContent?.trim() &&
								!paragraph.getElementsByTagNameNS(NS, 'drawing')
									.length
							)
								continue;
							const effective = effectiveAlignment(
								paragraph,
								cell,
								row,
								table,
								resolveStyle,
								defaults,
								rowIndex,
								cursor,
								cursor + span,
								grid.length,
							);
							if (
								effective !== STO_RULES.tables.headerAlignment
							) {
								failures[
									'Table Header Horizontal Alignment'
								].push(
									`${location}, cell ${cellIndex + 1}${effective.startsWith('unverified') ? `: ${effective}` : ''}`,
								);
							}
						}
					}
					cursor += span;
				}
				// tcW is a preferred width, not a strict grid equation. vMerge keeps its grid span.
				if (
					invalidGrid ||
					(grid.length > 0 && cursor + after !== grid.length)
				)
					failures['Table Grid Structure'].push(location);
			});
		});
		return Object.entries(failures).map(([check, locations]) => ({
			check,
			passed: locations.length === 0,
			...(locations.length
				? {
						error: `${locations.length} violation(s): ${locations.join('; ')}`,
					}
				: {}),
		}));
	} finally {
		document.close();
		styles.close();
	}
}

/** Repeating is a boolean property; an explicit false flag does not enable repetition. */
export function countTablesWithoutHeaderRepeat(docXml: string): number {
	const document = parse(docXml);
	try {
		return reportTables(document.root).filter(table => {
			if (isMathLayoutTable(table.outerHTML)) return false;
			const rows = children(table, 'tr');
			return (
				rows.length > 1 &&
				!enabled(child(child(rows[0], 'trPr'), 'tblHeader'))
			);
		}).length;
	} finally {
		document.close();
	}
}
