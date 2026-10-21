import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { isMathLayoutTable } from '@/shared/lib';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT = 'word/document.xml';

export interface WordcraftParagraphProbe {
	path: number[];
	row: number;
	edge: 'start' | 'end';
}

export interface WordcraftTableCandidate {
	tableBlock: number;
	captionBlock: number;
	number: string;
	rowCount: number;
	headerRows: number;
	tableSha256: string;
	probes: WordcraftParagraphProbe[];
	safeSplitRows: number[];
}

function children(element: Element, name: string): Element[] {
	return Array.from(element.children).filter(
		child => child.namespaceURI === WORD && child.localName === name,
	);
}

function property(element: Element, name: string): Element | undefined {
	return children(element, name)[0];
}

function ensure(element: Element, name: string): Element {
	let result = property(element, name);
	if (!result) {
		result = element.ownerDocument.createElementNS(WORD, `w:${name}`);
		element.insertBefore(result, element.firstChild);
	}
	return result;
}

function read(docx: string) {
	const archive = new AdmZip(docx);
	const entry = archive.getEntry(DOCUMENT);
	if (!entry) throw new Error('Wordcraft tables: missing word/document.xml.');
	const document = new JSDOM(entry.getData().toString('utf8'), {
		contentType: 'text/xml',
	}).window.document;
	const body = document.getElementsByTagNameNS(WORD, 'body')[0];
	if (!body) throw new Error('Wordcraft tables: missing document body.');
	return { archive, document, body };
}

function tocParagraphs(container: Element): Element[] | undefined {
	const properties = property(container, 'sdtPr');
	const object = properties && property(properties, 'docPartObj');
	if (
		object &&
		property(object, 'docPartGallery')?.getAttributeNS(WORD, 'val') ===
			'Table of Contents'
	) {
		const contents = children(container, 'sdtContent');
		if (
			contents.length !== 1 ||
			Array.from(container.children).some(
				node =>
					node.namespaceURI !== WORD ||
					!['sdtPr', 'sdtEndPr', 'sdtContent'].includes(
						node.localName,
					),
			)
		)
			return;
		const paragraphs = Array.from(contents[0].children);
		if (
			paragraphs.every(
				node => node.namespaceURI === WORD && node.localName === 'p',
			)
		)
			return paragraphs;
	}
}

function blocks(body: Element): Element[] {
	const all = Array.from(body.children);
	return all.flatMap((child, index) => {
		if (child.namespaceURI === WORD) {
			if (child.localName === 'sectPr' && index === all.length - 1)
				return [];
			if (['p', 'tbl'].includes(child.localName)) return [child];
			if (child.localName === 'sdt') {
				const paragraphs = tocParagraphs(child);
				if (paragraphs) return paragraphs;
			}
		}
		throw new Error(
			'ambiguous body containers prevent reliable Wordcraft paths',
		);
	});
}

function captionNumber(caption: Element | undefined): string | undefined {
	if (caption?.localName !== 'p') return;
	const text = Array.from(caption.getElementsByTagNameNS(WORD, 't'))
		.map(node => node.textContent)
		.join('')
		.trim();
	return /^(?:Таблица\s+((?:[А-ЯЁ]\.)?\d+(?:\.\d+)*)\s+–\s+\S.*|Продолжение таблицы\s+((?:[А-ЯЁ]\.)?\d+(?:\.\d+)*))$/u
		.exec(text)
		?.slice(1)
		.find(Boolean);
}

function hash(table: Element): string {
	return createHash('sha256').update(table.outerHTML).digest('hex');
}

function isHeader(row: Element): boolean {
	const properties = property(row, 'trPr');
	const marker = properties && property(properties, 'tblHeader');
	return Boolean(
		marker &&
		!['0', 'false', 'off'].includes(
			marker.getAttributeNS(WORD, 'val') ?? '',
		),
	);
}

function headerCount(rows: Element[]): number {
	const firstBody = rows.findIndex(row => !isHeader(row));
	const count = firstBody < 0 ? rows.length : firstBody;
	if (!count || rows.slice(count).some(isHeader))
		throw new Error('table requires a contiguous repeated header prefix');
	return count;
}

function rejectHeaderIds(headers: Element[]): void {
	for (const header of headers) {
		for (const node of Array.from(header.getElementsByTagName('*'))) {
			if (
				[
					'bookmarkStart',
					'bookmarkEnd',
					'commentRangeStart',
					'commentRangeEnd',
					'commentReference',
					'docPr',
					'cNvPr',
				].includes(node.localName) ||
				(node.localName === 'id' &&
					node.parentElement?.localName === 'sdtPr')
			)
				throw new Error(
					`repeated header contains unsafe duplicate identifier: ${node.localName}`,
				);
		}
	}
}

function inspect(
	table: Element,
	tableBlock: number,
	number: string,
): WordcraftTableCandidate {
	if (table.getElementsByTagNameNS(WORD, 'tbl').length)
		throw new Error('nested tables are unsupported');
	if (
		Array.from(table.children).some(
			node =>
				node.namespaceURI !== WORD ||
				!['tblPr', 'tblGrid', 'tr'].includes(node.localName),
		)
	)
		throw new Error('ambiguous table containers');
	const rows = children(table, 'tr');
	const headerRows = headerCount(rows);
	rejectHeaderIds(rows.slice(0, headerRows));
	const probes: WordcraftParagraphProbe[] = [];
	rows.forEach((row, rowIndex) => {
		if (
			Array.from(row.children).some(
				node =>
					node.namespaceURI !== WORD ||
					!['trPr', 'tc'].includes(node.localName),
			)
		)
			throw new Error('ambiguous row containers');
		if (!children(row, 'tc').length)
			throw new Error('table row has no cells');
		children(row, 'tc').forEach((cell, cellIndex) => {
			const paragraphs = Array.from(cell.children).filter(
				node => node.localName !== 'tcPr',
			);
			if (
				!paragraphs.length ||
				paragraphs.some(
					node =>
						node.namespaceURI !== WORD || node.localName !== 'p',
				)
			)
				throw new Error('ambiguous cell paragraph containers');
			paragraphs.forEach((_paragraph, paragraphIndex) => {
				for (const edge of ['start', 'end'] as const)
					probes.push({
						path: [tableBlock, rowIndex, cellIndex, paragraphIndex],
						row: rowIndex,
						edge,
					});
			});
		});
	});
	const safeSplitRows = rows.flatMap((row, index) =>
		index > headerRows &&
		!Array.from(row.getElementsByTagNameNS(WORD, 'vMerge')).some(
			merge => merge.getAttributeNS(WORD, 'val') !== 'restart',
		)
			? [index]
			: [],
	);
	return {
		tableBlock,
		captionBlock: tableBlock - 1,
		number,
		rowCount: rows.length,
		headerRows,
		tableSha256: hash(table),
		probes,
		safeSplitRows,
	};
}

export function inventoryWordcraftTables(docx: string): {
	tables: WordcraftTableCandidate[];
	warnings: string[];
} {
	const { body } = read(docx);
	const tables: WordcraftTableCandidate[] = [];
	const warnings: string[] = [];
	let elements: Element[];
	try {
		elements = blocks(body);
	} catch (error) {
		return { tables, warnings: [`Wordcraft tables: ${String(error)}`] };
	}
	elements.forEach((table, index) => {
		const number = captionNumber(elements[index - 1]);
		if (
			table.localName !== 'tbl' ||
			!number ||
			elements[index - 1].parentElement !== body ||
			isMathLayoutTable(table.outerHTML)
		)
			return;
		try {
			tables.push(inspect(table, index, number));
		} catch (error) {
			warnings.push(
				`Wordcraft table ${number} at block ${index}: ${String(error)}`,
			);
		}
	});
	return { tables, warnings };
}

function clearBottomBorder(table: Element): void {
	const borders = ensure(ensure(table, 'tblPr'), 'tblBorders');
	ensure(borders, 'bottom').setAttributeNS(WORD, 'w:val', 'nil');
	const lastRow = children(table, 'tr').at(-1)!;
	for (const bottom of Array.from(
		lastRow.getElementsByTagNameNS(WORD, 'bottom'),
	)) {
		if (
			['tcBorders', 'tblBorders'].includes(
				bottom.parentElement?.localName ?? '',
			)
		)
			bottom.setAttributeNS(WORD, 'w:val', 'nil');
	}
	for (const cell of children(lastRow, 'tc'))
		ensure(
			ensure(ensure(cell, 'tcPr'), 'tcBorders'),
			'bottom',
		).setAttributeNS(WORD, 'w:val', 'nil');
}

interface TablePlan {
	tableBlock: number;
	expectedRowCount: number;
	expectedTableSha256: string;
}

function plannedTable(stagedDocx: string, plan: TablePlan) {
	const { archive, document, body } = read(stagedDocx);
	const elements = blocks(body);
	const table = elements[plan.tableBlock];
	const number = captionNumber(elements[plan.tableBlock - 1]);
	if (
		!table ||
		table.localName !== 'tbl' ||
		!number ||
		elements[plan.tableBlock - 1].parentElement !== body
	)
		throw new Error(
			'Wordcraft table split requires an immediately captioned top-level table.',
		);
	const candidate = inspect(table, plan.tableBlock, number);
	if (
		candidate.rowCount !== plan.expectedRowCount ||
		candidate.tableSha256 !== plan.expectedTableSha256
	)
		throw new Error(
			'Wordcraft table split stale plan: row count or table hash changed.',
		);
	return {
		archive,
		document,
		body,
		table,
		number,
		candidate,
		caption: elements[plan.tableBlock - 1],
	};
}

export function ensureWordcraftTablePageStart(
	stagedDocx: string,
	plan: TablePlan,
): boolean {
	const { archive, document, caption } = plannedTable(stagedDocx, plan);
	const properties = ensure(caption, 'pPr');
	const enabled = (name: string) => {
		const marker = property(properties, name);
		return (
			marker &&
			!['0', 'false', 'off'].includes(
				marker.getAttributeNS(WORD, 'val') ?? '',
			)
		);
	};
	if (
		enabled('keepNext') &&
		enabled('pageBreakBefore') &&
		property(properties, 'jc')?.getAttributeNS(WORD, 'val') === 'left'
	)
		return false;
	for (const name of ['keepNext', 'pageBreakBefore'])
		ensure(properties, name).setAttributeNS(WORD, 'w:val', '1');
	ensure(properties, 'jc').setAttributeNS(WORD, 'w:val', 'left');
	archive.updateFile(
		DOCUMENT,
		Buffer.from(document.documentElement.outerHTML),
	);
	archive.writeZip(stagedDocx);
	return true;
}

export function applyWordcraftTableSplit(
	stagedDocx: string,
	plan: {
		tableBlock: number;
		splitBeforeRow: number;
		expectedRowCount: number;
		expectedTableSha256: string;
	},
): { originalRows: number; headerRows: number; continuationRows: number } {
	const {
		archive,
		document,
		body,
		table,
		number,
		candidate,
		caption: previousCaption,
	} = plannedTable(stagedDocx, plan);
	if (!candidate.safeSplitRows.includes(plan.splitBeforeRow))
		throw new Error(
			'Wordcraft table split unsafe split row or crossing vertical merge.',
		);
	const rows = children(table, 'tr');
	const continuation = table.cloneNode(false) as Element;
	for (const child of Array.from(table.children))
		if (['tblPr', 'tblGrid'].includes(child.localName))
			continuation.appendChild(child.cloneNode(true));
	for (const header of rows.slice(0, candidate.headerRows))
		continuation.appendChild(header.cloneNode(true));
	for (const row of rows.slice(plan.splitBeforeRow))
		continuation.appendChild(row);
	clearBottomBorder(table);
	const caption = document.createElementNS(WORD, 'w:p');
	const previousProperties = property(previousCaption, 'pPr');
	if (previousProperties)
		caption.appendChild(previousProperties.cloneNode(true));
	const properties = ensure(caption, 'pPr');
	// Section boundaries and revision identities belong to the source paragraph.
	for (const name of ['sectPr', 'pPrChange'])
		for (const structural of children(properties, name))
			structural.remove();
	for (const name of ['keepNext', 'pageBreakBefore'])
		ensure(properties, name).setAttributeNS(WORD, 'w:val', '1');
	ensure(properties, 'jc').setAttributeNS(WORD, 'w:val', 'left');
	const run = document.createElementNS(WORD, 'w:r');
	const text = document.createElementNS(WORD, 'w:t');
	text.textContent = `Продолжение таблицы ${number}`;
	run.appendChild(text);
	caption.appendChild(run);
	body.insertBefore(caption, table.nextSibling);
	body.insertBefore(continuation, caption.nextSibling);
	archive.updateFile(
		DOCUMENT,
		Buffer.from(document.documentElement.outerHTML),
	);
	archive.writeZip(stagedDocx);
	return {
		originalRows: rows.length,
		headerRows: candidate.headerRows,
		continuationRows: children(continuation, 'tr').length,
	};
}
