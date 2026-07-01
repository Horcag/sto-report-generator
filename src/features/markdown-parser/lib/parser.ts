import { AlignmentType, Paragraph, TextRun } from 'docx';
import { marked, Token, Tokens } from 'marked';

import {
	getNumberedHeadingStyleId,
	HEADING_NUMBERING_REFERENCE,
} from '@/shared/config';
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

interface MarkdownParserOptions {
	sourceDir?: string;
}

class MarkdownParser {
	private context: ParserContext;
	private references: ReferenceRegistry;

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

	private async processTokens(
		tokensToProcess: Token[],
		currentContext: ProcessTokensContext = {},
	): Promise<DocxElement[]> {
		const elements: DocxElement[] = [];
		let activeStructuralHeading = currentContext.structuralHeading;
		for (const token of tokensToProcess) {
			const tokenContext: ProcessTokensContext = {
				...currentContext,
				structuralHeading: activeStructuralHeading,
			};
			switch (token.type) {
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
					elements.push(
						new Paragraph({
							style: getNumberedHeadingStyleId(
								headingToken.depth,
							),
							numbering: {
								reference: HEADING_NUMBERING_REFERENCE,
								level: Math.max(
									0,
									Math.min(headingToken.depth - 1, 5),
								),
							},
							children: await parseInline(
								headingToken.tokens,
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
						await handleTable(token as Tokens.Table, tks =>
							parseInline(
								tks,
								this.context,
								key => getCitationNumber(this.context, key),
								text => this.references.replaceRefs(text),
							),
						),
					);
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
