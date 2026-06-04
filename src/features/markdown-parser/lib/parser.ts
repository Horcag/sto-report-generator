import * as fs from 'fs';
import * as path from 'path';
import * as bibtexParse from '@orcid/bibtex-parse-js';
import { AlignmentType, Paragraph, TextRun } from 'docx';
import { marked, Token, Tokens } from 'marked';

import { getNumberedHeadingStyleId } from '@/shared/config';
import { mathJaxReady } from '@/shared/lib/math-converter';

import {
	handleList,
	handleParagraph,
	handleTable,
} from './parser/handlers/block-handlers';
import { parseInline } from './parser/handlers/inline-parser';
import { handleStoFlag } from './parser/handlers/sto-handler';
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

	constructor(bibDb: BibItem[] = [], options: MarkdownParserOptions = {}) {
		this.context = {
			itemMap: new Map<string, number>(),
			citations: [],
			bibDb,
			listInstanceCounter: 0,
			sourceDir: options.sourceDir,
		};
	}

	public async parse(tokens: Token[]): Promise<DocxElement[]> {
		this.assignNumbers(tokens);
		return this.processTokens(tokens);
	}

	private assignNumbers(tokens: Token[]) {
		let figCounter = 0;
		let tabCounter = 0;
		let eqCounter = 0;

		const walk = (tks: Token[]) => {
			for (const token of tks) {
				if (
					token.type === 'paragraph' ||
					token.type === 'text' ||
					token.type === 'heading'
				) {
					const text =
						'text' in token ? (token.text as string) : token.raw;

					const figMatch = text.match(
						/(?:Рисунок|Рис\.)\s+.*?(@fig:[a-zA-Z0-9_-]+)/,
					);
					if (figMatch && !this.context.itemMap.has(figMatch[1])) {
						figCounter++;
						this.context.itemMap.set(figMatch[1], figCounter);
					}

					const tabMatch = text.match(
						/Таблица\s+.*?(@tab:[a-zA-Z0-9_-]+)/,
					);
					if (tabMatch && !this.context.itemMap.has(tabMatch[1])) {
						tabCounter++;
						this.context.itemMap.set(tabMatch[1], tabCounter);
					}

					const blockMathMatches = text.matchAll(/\$\$[\s\S]+?\$\$/g);
					for (const blockMathMatch of blockMathMatches) {
						const eqMatch = blockMathMatch[0].match(
							/\((@eq:[a-zA-Z0-9_-]+)\)\s*\$\$/,
						);
						if (eqMatch && !this.context.itemMap.has(eqMatch[1])) {
							eqCounter++;
							this.context.itemMap.set(eqMatch[1], eqCounter);
						}
					}
				}

				if ('tokens' in token && token.tokens) {
					walk(token.tokens as Token[]);
				} else if (token.type === 'list') {
					(token as Tokens.List).items.forEach(i =>
						walk(i.tokens || []),
					);
				} else if (token.type === 'table') {
					(token as Tokens.Table).rows.forEach(r =>
						r.forEach(c => walk(c.tokens || [])),
					);
				}
			}
		};
		walk(tokens);
	}

	private getCitationNum = (key: string): number => {
		let idx = this.context.citations.indexOf(key);
		if (idx === -1) {
			this.context.citations.push(key);
			idx = this.context.citations.length - 1;
		}
		return idx + 1;
	};

	private replaceRefs = (text: string): string => {
		return text.replace(/@(fig|tab|eq):([a-zA-Z0-9_-]+)/g, match => {
			if (this.context.itemMap.has(match))
				return String(this.context.itemMap.get(match));
			return `[${match} NOT FOUND]`;
		});
	};

	private async processTokens(
		tokensToProcess: Token[],
		currentContext: ProcessTokensContext = {},
	): Promise<DocxElement[]> {
		const elements: DocxElement[] = [];
		for (const token of tokensToProcess) {
			switch (token.type) {
				case 'stoFlag':
					elements.push(
						...(await handleStoFlag(
							token as unknown as StoFlagToken,
							this.context,
							this.processTokens.bind(this),
							currentContext,
						)),
					);
					break;
				case 'heading': {
					const headingToken = token as Tokens.Heading;
					elements.push(
						new Paragraph({
							style: getNumberedHeadingStyleId(
								headingToken.depth,
							),
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
									this.getCitationNum,
									this.replaceRefs,
								),
							currentContext,
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
									this.getCitationNum,
									this.replaceRefs,
								),
							this.processTokens.bind(this),
							currentContext,
						)),
					);
					break;
				case 'table':
					elements.push(
						await handleTable(token as Tokens.Table, tks =>
							parseInline(
								tks,
								this.context,
								this.getCitationNum,
								this.replaceRefs,
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

	let bibDb: BibItem[] = [];
	if (metadata.bibliography) {
		const bibPath = path.resolve(
			process.cwd(),
			String(metadata.bibliography),
		);
		if (fs.existsSync(bibPath)) {
			const bibContent = fs.readFileSync(bibPath, 'utf-8');
			bibDb = bibtexParse.toJSON(bibContent) as BibItem[];
		} else {
			console.warn(`Bibliography file not found: ${bibPath}`);
		}
	}

	const normalizedText = markdownText.replace(/—/g, '–');
	const tokens = marked.lexer(normalizedText);

	const parser = new MarkdownParser(bibDb, options);
	return parser.parse(tokens);
}
