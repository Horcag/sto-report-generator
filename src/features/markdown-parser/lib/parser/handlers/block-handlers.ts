import {
	AlignmentType,
	Paragraph,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';
import { Tokens as MarkedTokens, Token } from 'marked';

import { STO_RULES } from '@/shared/config';

import {
	DocxElement,
	InlineDocxElement,
	ParserContext,
	ProcessTokensContext,
} from '../../types';
import { handleBlockMath } from './math-handler';

function isReferatKeywordsParagraph(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.includes(',') || !/[A-ZА-ЯЁ]/.test(trimmed)) {
		return false;
	}

	const keywords = trimmed
		.replace(/[.]$/, '')
		.split(',')
		.map(item => item.trim())
		.filter(Boolean);

	return (
		keywords.length >= STO_RULES.referat.keywordCount.min &&
		keywords.length <= STO_RULES.referat.keywordCount.max &&
		trimmed === trimmed.toUpperCase()
	);
}

/**
 * Handles paragraph tokens and converts them to Docx Paragraphs or Tables (for math blocks).
 */
export async function handleParagraph(
	token: MarkedTokens.Paragraph,
	context: ParserContext,
	parseInline: (tokens: Token[]) => Promise<InlineDocxElement[]>,
	currentContext: ProcessTokensContext,
): Promise<DocxElement[]> {
	const text = token.text;

	// Check for block math. We use a more robust split to handle multiple blocks
	// and ensure they are processed as separate Table elements for centering.
	if (text.includes('$$')) {
		const parts = text.split(/(\$\$[\s\S]+?\$\$)/g);
		const result: DocxElement[] = [];
		for (const part of parts) {
			const match = part.match(/^\$\$([\s\S]+?)\$\$/);
			if (match) {
				result.push(await handleBlockMath(match[1].trim(), context));
			} else if (part.trim().length > 0) {
				// Handle potential text around math blocks in the same paragraph
				// though usually STO expects math blocks to be separate
				result.push(
					new Paragraph({
						style: 'Normal',
						children: await parseInline([
							{ type: 'text', raw: part, text: part } as Token,
						]),
					}),
				);
			}
		}
		if (result.length > 0) return result;
	}

	if (token.tokens?.every(item => item.type === 'image')) {
		return [
			new Paragraph({
				style: 'Normal',
				alignment: AlignmentType.CENTER,
				indent: { firstLine: 0 },
				children: await parseInline(token.tokens),
			}),
		];
	}

	if (currentContext.isStoList) {
		const itemTokens = token.tokens || [];
		if (itemTokens.length > 0 && itemTokens[0].type === 'text') {
			itemTokens[0].raw = itemTokens[0].raw.replace(
				/^(?:-|\*|\d+\.)\s+/,
				'',
			);
			itemTokens[0].text = itemTokens[0].text.replace(
				/^(?:-|\*|\d+\.)\s+/,
				'',
			);
		}
		return [
			new Paragraph({
				style: 'Normal',
				indent: {
					left: 0,
					firstLine: STO_RULES.typography.firstLineIndentDxa,
				},
				numbering:
					currentContext.listType === 'ordered'
						? {
								reference: 'ordered-numbering',
								level: 0,
								instance: currentContext.instance,
							}
						: {
								reference: 'list-numbering',
								level: 0,
								instance: currentContext.instance,
							},
				children: await parseInline(itemTokens),
			}),
		];
	}

	if (/^(?:Рисунок|Рис\.)\s*(?:@fig:[a-zA-Z0-9_-]+|\d+)/.test(text.trim())) {
		return [
			new Paragraph({
				style: 'FigureCaption',
				children: await parseInline(token.tokens || []),
			}),
		];
	}

	if (/^Таблица\s*(?:@tab:[a-zA-Z0-9_-]+|\d+)/.test(text.trim())) {
		return [
			new Paragraph({
				style: 'TableCaption',
				children: await parseInline(token.tokens || []),
			}),
		];
	}

	if (
		currentContext.structuralHeading === 'РЕФЕРАТ' &&
		isReferatKeywordsParagraph(text)
	) {
		return [
			new Paragraph({
				style: 'Normal',
				alignment: AlignmentType.JUSTIFIED,
				spacing: {
					before: STO_RULES.referat.keywordParagraph.spacingBeforeDxa,
					after: STO_RULES.referat.keywordParagraph.spacingAfterDxa,
					line: STO_RULES.typography.normalLineSpacingDxa,
					lineRule: 'auto',
				},
				indent: {
					left: 0,
					right: 0,
					firstLine: STO_RULES.typography.firstLineIndentDxa,
				},
				children: [
					new TextRun({
						text: text.trim(),
						allCaps: true,
					}),
				],
			}),
		];
	}

	return [
		new Paragraph({
			style: 'Normal',
			indent: text.trim().startsWith('где')
				? { firstLine: 0 }
				: undefined,
			children: await parseInline(token.tokens || []),
		}),
	];
}

/**
 * Handles list tokens and converts them to Docx Paragraphs with numbering.
 */
export async function handleList(
	token: MarkedTokens.List,
	context: ParserContext,
	parseInline: (tokens: Token[]) => Promise<InlineDocxElement[]>,
	processTokens: (
		tokens: Token[],
		currentContext?: ProcessTokensContext,
	) => Promise<DocxElement[]>,
	currentContext: ProcessTokensContext = {},
	listLevel: number = 0,
): Promise<DocxElement[]> {
	if (listLevel === 0) {
		context.listInstanceCounter++;
	}
	const instance = context.listInstanceCounter;
	const elements: DocxElement[] = [];

	for (const item of token.items) {
		// Separation of inline vs nested block tokens
		const textTokens = item.tokens.filter((t: Token) => t.type !== 'list');
		const nestedListTokens = item.tokens.filter(
			(t: Token) => t.type === 'list',
		);

		elements.push(
			new Paragraph({
				style: 'Normal',
				numbering: token.ordered
					? {
							reference: 'ordered-numbering',
							level: listLevel,
							instance: instance,
						}
					: {
							reference: 'list-numbering',
							level: listLevel,
							instance: instance,
						},
				children: await parseInline(textTokens),
			}),
		);

		for (const nestedList of nestedListTokens) {
			elements.push(
				...(await handleList(
					nestedList as MarkedTokens.List,
					context,
					parseInline,
					processTokens,
					currentContext,
					listLevel + 1,
				)),
			);
		}
	}
	return elements;
}

const TOTAL_TABLE_WIDTH_DXA = 9355; // A4 (11906) - Left margin (1701) - Right margin (850)
const TABLE_CELL_HORIZONTAL_MARGIN_DXA = 108; // Normal Table in the canonical DOTM
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

function normalizeWidths(weights: number[]): number[] {
	const floors = weights.map(() => MIN_COLUMN_WIDTH_DXA);
	const available = TOTAL_TABLE_WIDTH_DXA - floors.reduce((a, b) => a + b, 0);
	if (available <= 0) {
		const equal = Math.floor(TOTAL_TABLE_WIDTH_DXA / weights.length);
		const widths = weights.map(() => equal);
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
	for (let c = 0; c < numCols; c++) {
		const cellTexts = [
			token.header[c]?.text || '',
			...token.rows.map(row => row[c]?.text || ''),
		];
		const measured = cellTexts.map(visibleTextWidth);
		const peak = Math.max(...measured, 1);
		const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
		weights.push(Math.sqrt(peak * Math.max(mean, 1)));
	}
	return normalizeWidths(weights);
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
		width: { size: TOTAL_TABLE_WIDTH_DXA, type: WidthType.DXA },
		layout: TableLayoutType.FIXED,
		columnWidths: columnWidths,
		margins: {
			top: 0,
			bottom: 0,
			left: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
			right: TABLE_CELL_HORIZONTAL_MARGIN_DXA,
		},
		rows: [headerRow, ...rows],
	});
}
