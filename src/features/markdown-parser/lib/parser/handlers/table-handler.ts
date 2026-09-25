import {
	AlignmentType,
	BorderStyle,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	WidthType,
} from 'docx';
import { Tokens as MarkedTokens, Token } from 'marked';

import { InlineDocxElement } from '../../types';

const TOTAL_TABLE_WIDTH_DXA = 9355; // A4 (11906) - Left margin (1701) - Right margin (850)
const TABLE_CELL_HORIZONTAL_MARGIN_DXA = 108; // Normal Table in the canonical DOTM
const TABLE_CELL_VERTICAL_MARGIN_DXA = 57; // 1 mm keeps text clear of cell borders
const TABLE_CODE_CHARACTER_WIDTH_DXA = 175; // Courier New 14 pt is about 168 DXA per character
const MIN_COLUMN_WIDTH_DXA = 720;

function visibleTextWidth(text: string): number {
	const clean = text
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/[*_`]/g, '');
	return Math.max(
		...clean.split('\n').map(line =>
			Array.from(line).reduce((width, char) => {
				if (/\s/u.test(char)) return width + 0.35;
				if (/[.,:;!|'ijlI1]/u.test(char)) return width + 0.45;
				if (/[MWЖШЩЮФ]/u.test(char)) return width + 1.25;
				return width + 1;
			}, 0),
		),
	);
}

function normalizeWidths(weights: number[], minimumWidths: number[]): number[] {
	const floors = minimumWidths.map(width =>
		Math.max(MIN_COLUMN_WIDTH_DXA, width),
	);
	const available = TOTAL_TABLE_WIDTH_DXA - floors.reduce((a, b) => a + b, 0);
	if (available <= 0) {
		const base =
			MIN_COLUMN_WIDTH_DXA * floors.length <= TOTAL_TABLE_WIDTH_DXA
				? MIN_COLUMN_WIDTH_DXA
				: Math.floor(TOTAL_TABLE_WIDTH_DXA / floors.length);
		const extras = floors.map(width => width - base);
		const extraSum = extras.reduce((a, b) => a + b, 0);
		const remaining = TOTAL_TABLE_WIDTH_DXA - base * floors.length;
		const widths = extras.map(extra =>
			Math.round(base + (extra / extraSum) * remaining),
		);
		widths[widths.length - 1] +=
			TOTAL_TABLE_WIDTH_DXA - widths.reduce((a, b) => a + b, 0);
		return widths;
	}
	const sum = weights.reduce((a, b) => a + b, 0);
	const widths = floors.map((floor, index) =>
		Math.round(floor + available * (weights[index] / sum)),
	);
	widths[widths.length - 1] +=
		TOTAL_TABLE_WIDTH_DXA - widths.reduce((a, b) => a + b, 0);
	return widths;
}

export function computeTableColumnWidths(
	token: MarkedTokens.Table,
	explicitWidths?: number[],
): number[] {
	const numCols = token.header.length;
	if (numCols === 0) return [];

	// 1. Explicit widths from <!-- widths: ... -->
	if (explicitWidths && explicitWidths.length === numCols) {
		const sum = explicitWidths.reduce((a, b) => a + b, 0);
		const widths = explicitWidths.map(width =>
			Math.round((width / sum) * TOTAL_TABLE_WIDTH_DXA),
		);
		widths[widths.length - 1] +=
			TOTAL_TABLE_WIDTH_DXA - widths.reduce((a, b) => a + b, 0);
		return widths;
	}

	// Markdown delimiter dashes express alignment, not physical width. Estimate
	// readable widths from visible text and reserve a real minimum for every column.
	const weights: number[] = [];
	const minimumWidths: number[] = [];
	for (let c = 0; c < numCols; c++) {
		const cellTexts = [
			token.header[c]?.text || '',
			...token.rows.map(row => row[c]?.text || ''),
		];
		const measured = cellTexts.map(visibleTextWidth);
		const peak = Math.max(...measured, 1);
		const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
		weights.push(Math.sqrt(peak * Math.max(mean, 1)));
		const longestToken = Math.max(
			...cellTexts.flatMap(text =>
				text
					.replace(/<br\s*\/?\s*>/gi, ' ')
					.replace(/<[^>]+>/g, '')
					.replace(/[*_`]/g, match => (match === '_' ? match : ''))
					.split(/\s+/u)
					.map(visibleTextWidth),
			),
			0,
		);
		const longestCodeToken = Math.max(
			...cellTexts.flatMap(text =>
				[...text.matchAll(/`([^`]+)`/g)].flatMap(match =>
					match[1]
						.split(/\s+/u)
						.map(token => Array.from(token).length),
				),
			),
			0,
		);
		// TableText is 14 pt. Reserve space for the longest word or identifier
		// before distributing the remaining width by typical cell content.
		minimumWidths.push(
			Math.ceil(
				Math.max(
					longestToken * 135,
					longestCodeToken * TABLE_CODE_CHARACTER_WIDTH_DXA,
				) +
					2 * TABLE_CELL_HORIZONTAL_MARGIN_DXA,
			),
		);
	}
	return normalizeWidths(weights, minimumWidths);
}

function getCellAlignment(
	align: string | null,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
	switch (align) {
		case 'center':
			return AlignmentType.CENTER;
		case 'right':
			return AlignmentType.RIGHT;
		case 'left':
		default:
			return AlignmentType.LEFT;
	}
}

/**
 * Handles table tokens and converts them to Docx Tables.
 */
export async function handleTable(
	token: MarkedTokens.Table,
	parseInline: (
		tokens: Token[],
		options?: { bold?: boolean; allowBold?: boolean },
	) => Promise<InlineDocxElement[]>,
	explicitWidths?: number[],
	continuedOnNextSegment = false,
): Promise<Table> {
	const columnWidths = computeTableColumnWidths(token, explicitWidths);

	const rows: TableRow[] = [];
	for (const row of token.rows) {
		const rowCells: TableCell[] = [];
		for (let colIdx = 0; colIdx < row.length; colIdx++) {
			const cell = row[colIdx];
			const alignType = getCellAlignment(token.align[colIdx]);
			const colWidth = columnWidths[colIdx] ?? 1000;

			rowCells.push(
				new TableCell({
					width: { size: colWidth, type: WidthType.DXA },
					margins: {
						top: TABLE_CELL_VERTICAL_MARGIN_DXA,
						bottom: TABLE_CELL_VERTICAL_MARGIN_DXA,
						left: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
						right: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
					},
					children: [
						new Paragraph({
							style: 'TableText',
							alignment: alignType,
							children: await parseInline(cell.tokens, {
								allowBold: true,
							}),
						}),
					],
				}),
			);
		}
		rows.push(
			new TableRow({
				cantSplit: true,
				children: rowCells,
			}),
		);
	}

	const headerCells: TableCell[] = [];
	for (let colIdx = 0; colIdx < token.header.length; colIdx++) {
		const cell = token.header[colIdx];
		const colWidth = columnWidths[colIdx] ?? 1000;

		headerCells.push(
			new TableCell({
				width: { size: colWidth, type: WidthType.DXA },
				margins: {
					top: TABLE_CELL_VERTICAL_MARGIN_DXA,
					bottom: TABLE_CELL_VERTICAL_MARGIN_DXA,
					left: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
					right: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
				},
				children: [
					new Paragraph({
						style: 'TableText',
						alignment: getCellAlignment(token.align[colIdx]),
						children: await parseInline(cell.tokens, {
							allowBold: true,
						}),
					}),
				],
			}),
		);
	}
	const headerRow = new TableRow({
		children: headerCells,
		tableHeader: true,
		cantSplit: true,
	});

	return new Table({
		borders: continuedOnNextSegment
			? { bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' } }
			: undefined,
		width: { size: TOTAL_TABLE_WIDTH_DXA, type: WidthType.DXA },
		layout: TableLayoutType.FIXED,
		columnWidths: columnWidths,
		margins: {
			top: TABLE_CELL_VERTICAL_MARGIN_DXA,
			bottom: TABLE_CELL_VERTICAL_MARGIN_DXA,
			left: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
			right: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
		},
		rows: [headerRow, ...rows],
	});
}
