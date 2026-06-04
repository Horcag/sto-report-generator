import {
	AlignmentType,
	Paragraph,
	Table,
	TableCell,
	TableRow,
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

/**
 * Handles table tokens and converts them to Docx Tables.
 */
export async function handleTable(
	token: MarkedTokens.Table,
	parseInline: (tokens: Token[]) => Promise<InlineDocxElement[]>,
): Promise<Table> {
	const rows = [];
	for (const row of token.rows) {
		const rowCells = [];
		for (const cell of row) {
			rowCells.push(
				new TableCell({
					children: [
						new Paragraph({
							style: 'TableText',
							children: await parseInline(cell.tokens),
						}),
					],
				}),
			);
		}
		rows.push(new TableRow({ children: rowCells }));
	}

	const headerCells = [];
	for (const cell of token.header) {
		headerCells.push(
			new TableCell({
				children: [
					new Paragraph({
						style: 'TableText',
						children: await parseInline(cell.tokens),
					}),
				],
			}),
		);
	}
	const headerRow = new TableRow({
		children: headerCells,
		tableHeader: true,
	});

	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		rows: [headerRow, ...rows],
	});
}
