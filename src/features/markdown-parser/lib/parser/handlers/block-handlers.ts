import { Paragraph, Table, TableCell, TableRow, WidthType } from 'docx';
import { Tokens as MarkedTokens, Token } from 'marked';

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

	// Math block
	const blockMathMatch = text.match(/^\$\$([\s\S]+)\$\$/);
	if (blockMathMatch) {
		return [await handleBlockMath(blockMathMatch[1].trim(), context)];
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
				indent: { left: 0, firstLine: 709 },
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
): Promise<DocxElement[]> {
	context.listInstanceCounter++;
	const elements: Paragraph[] = [];
	for (const item of token.items) {
		elements.push(
			new Paragraph({
				style: 'Normal',
				indent: { left: 0, firstLine: 709 },
				numbering: token.ordered
					? {
							reference: 'ordered-numbering',
							level: 0,
							instance: context.listInstanceCounter,
						}
					: {
							reference: 'list-numbering',
							level: 0,
							instance: context.listInstanceCounter,
						},
				children: await parseInline(item.tokens || []),
			}),
		);
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
	const headerRow = new TableRow({ children: headerCells });

	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		rows: [headerRow, ...rows],
	});
}
