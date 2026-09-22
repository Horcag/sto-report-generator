import { AlignmentType, Paragraph, TextRun } from 'docx';
import { marked, Token, Tokens } from 'marked';

import { getNumberedHeadingStyleId } from '@/shared/config';
import { mathJaxReady } from '@/shared/lib/math-converter';

import { loadBibliography } from './parser/bibliography-loader';
import { getCitationNumber } from './parser/citation-registry';
import {
	handleList,
	handleParagraph,
	handleTable,
} from './parser/handlers/block-handlers';
import { parseInline } from './parser/handlers/inline-parser';
import { handleStoFlag } from './parser/handlers/sto-handler';
import { ReferenceRegistry } from './parser/reference-registry';
import {
	BibItem,
	DocxElement,
	ParserContext,
	ProcessTokensContext,
	StoFlagToken,
} from './types';
import { mathExtension, stoExtension } from './utils/extensions';

marked.use({ extensions: [stoExtension, mathExtension] });

function stripExpectedHeadingNumber(
	tokens: Token[] | undefined,
	expectedNumber: string,
): Token[] {
	if (!tokens || tokens.length === 0) {
		return [];
	}
	const first = tokens[0];
	if (first.type === 'text') {
		const textToken = first as Tokens.Text;
		const escapedNumber = expectedNumber.replaceAll('.', String.raw`\.`);
		const expectedPrefix = new RegExp(`^${escapedNumber}\\.?\\s+`);
		const cleanedText = textToken.text.replace(expectedPrefix, '');
		const cleanedRaw = textToken.raw.replace(expectedPrefix, '');
		if (cleanedText !== textToken.text) {
			return [
				{
					...textToken,
					text: cleanedText,
					raw: cleanedRaw,
				},
				...tokens.slice(1),
			];
		}
	}
	return tokens;
}

interface MarkdownParserOptions {
	sourceDir?: string;
}

class MarkdownParser {
	private context: ParserContext;
	private references: ReferenceRegistry;
	private readonly headingCounters = Array.from({ length: 6 }, () => 0);

	constructor(bibDb: BibItem[] = [], options: MarkdownParserOptions = {}) {
		this.context = {
			itemMap: new Map<string, number>(),
			citations: [],
			bibDb,
			listInstanceCounter: 0,
			sourceDir: options.sourceDir,
		};
		this.references = new ReferenceRegistry(this.context.itemMap);
	}

	public async parse(tokens: Token[]): Promise<DocxElement[]> {
		this.references.assignNumbers(tokens);
		return this.processTokens(tokens);
	}

	private getCitationNum = (key: string): number =>
		getCitationNumber(this.context, key);

	private replaceRefs = (text: string): string =>
		this.references.replaceRefs(text);

	private getExpectedHeadingNumber(depth: number): string {
		const index = Math.max(0, Math.min(depth - 1, 5));
		this.headingCounters[index] += 1;
		this.headingCounters.fill(0, index + 1);
		return this.headingCounters.slice(0, index + 1).join('.');
	}

	private async processTokens(
		tokensToProcess: Token[],
		currentContext: ProcessTokensContext = {},
	): Promise<DocxElement[]> {
		const elements: DocxElement[] = [];
		let activeStructuralHeading = currentContext.structuralHeading;
		let pendingTableWidths: number[] | undefined;
		for (const token of tokensToProcess) {
			const tokenContext: ProcessTokensContext = {
				...currentContext,
				structuralHeading: activeStructuralHeading,
			};
			if (token.type !== 'space' && token.type !== 'html') {
				// Clear pending widths if intervening content appears before table,
				// unless this content is a table caption paragraph ("Таблица X...")
				const isTableCaption =
					token.type === 'paragraph' &&
					/^Таблица\s+\d+/i.test(
						((token as Tokens.Paragraph).text || '')
							.replace(/[*_#]/g, '')
							.trim(),
					);
				if (token.type !== 'table' && !isTableCaption) {
					pendingTableWidths = undefined;
				}
			}
			switch (token.type) {
				case 'html': {
					const rawHtml =
						(token as Tokens.HTML).raw ||
						(token as Tokens.HTML).text ||
						'';
					const match = rawHtml.match(
						/<!--\s*widths:\s*([0-9\s,%.]+)\s*-->/i,
					);
					if (match) {
						const parts = match[1]
							.split(',')
							.map(s => parseFloat(s.trim().replace('%', '')))
							.filter(n => !isNaN(n) && n > 0);
						if (parts.length > 0) {
							pendingTableWidths = parts;
						}
					}
					break;
				}
				case 'stoFlag':
					elements.push(
						...(await handleStoFlag(
							token as unknown as StoFlagToken,
							this.context,
							this.processTokens.bind(this),
							tokenContext,
						)),
					);
					if (
						(token as unknown as StoFlagToken).flagType ===
						'structural_heading'
					) {
						activeStructuralHeading = (
							(token as unknown as StoFlagToken).text || ''
						)
							.trim()
							.toUpperCase();
					}
					break;
				case 'heading': {
					activeStructuralHeading = undefined;
					const headingToken = token as Tokens.Heading;
					const expectedNumber = this.getExpectedHeadingNumber(
						headingToken.depth,
					);
					elements.push(
						new Paragraph({
							style: getNumberedHeadingStyleId(
								headingToken.depth,
							),
							children: await parseInline(
								stripExpectedHeadingNumber(
									headingToken.tokens,
									expectedNumber,
								),
								this.context,
								this.getCitationNum,
								this.replaceRefs,
							),
						}),
					);
					break;
				}
				case 'paragraph':
					elements.push(
						...(await handleParagraph(
							token as Tokens.Paragraph,
							this.context,
							tks =>
								parseInline(
									tks,
									this.context,
									key => getCitationNumber(this.context, key),
									text => this.references.replaceRefs(text),
								),
							tokenContext,
						)),
					);
					break;
				case 'list':
					elements.push(
						...(await handleList(
							token as Tokens.List,
							this.context,
							tks =>
								parseInline(
									tks,
									this.context,
									key => getCitationNumber(this.context, key),
									text => this.references.replaceRefs(text),
								),
							this.processTokens.bind(this),
							tokenContext,
						)),
					);
					break;
				case 'table':
					elements.push(
						await handleTable(
							token as Tokens.Table,
							(tks, opts) =>
								parseInline(
									tks,
									this.context,
									key => getCitationNumber(this.context, key),
									text => this.references.replaceRefs(text),
									opts,
								),
							pendingTableWidths,
						),
					);
					pendingTableWidths = undefined;
					break;
				case 'space':
					break;
				case 'code': {
					const codeToken = token as Tokens.Code;
					// Unescape HTML entities that marked might have escaped
					let codeText = codeToken.text
						.replace(/&amp;/g, '&')
						.replace(/&lt;/g, '<')
						.replace(/&gt;/g, '>')
						.replace(/&quot;/g, '"')
						.replace(/&#39;/g, "'");

					// To prevent Word from automatically coloring URLs blue,
					// insert a zero-width space after "http" and "https"
					codeText = codeText
						.replace(/https:\/\//g, 'https\u200B://')
						.replace(/http:\/\//g, 'http\u200B://');

					// Split code by newlines to insert breaks, and preserve spaces.
					const lines = codeText.split('\n');
					const runs = lines.map((line, index) => {
						return new TextRun({
							text: line,
							font: 'Courier New',
							size: 20, // 10pt is typical for code, smaller than 14pt body
							break: index > 0 ? 1 : 0,
						});
					});
					elements.push(
						new Paragraph({
							style: 'Normal', // We can use Normal but override font
							alignment: AlignmentType.LEFT, // Avoid justified stretching in code blocks
							spacing: {
								before: 0,
								after: 0,
								line: 240,
								lineRule: 'auto',
							}, // Single line spacing for compact code
							indent: { left: 0, firstLine: 0 },
							children: runs,
						}),
					);
					break;
				}
				default:
					console.warn(`Unhandled token type: ${token.type}`);
					break;
			}
		}
		return elements;
	}
}

export async function parseMarkdownToDocx(
	markdownText: string,
	metadata: Record<string, unknown> = {},
	options: MarkdownParserOptions = {},
): Promise<DocxElement[]> {
	await mathJaxReady();

	const bibDb = loadBibliography(metadata);
	const normalizedText = markdownText.replace(/—/g, '–');
	const tokens = marked.lexer(normalizedText);

	const parser = new MarkdownParser(bibDb, options);
	return parser.parse(tokens);
}
