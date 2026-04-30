import * as fs from 'fs';
import * as path from 'path';

import { mathJaxReady } from '@hungknguyen/docx-math-converter';
import * as bibtexParse from '@orcid/bibtex-parse-js';
import { Paragraph, TextRun } from 'docx';
import { marked, Token, Tokens } from 'marked';

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
import { stoExtension } from './utils/extensions';

marked.use({ extensions: [stoExtension] });

class MarkdownParser {
	private context: ParserContext;

	constructor(bibDb: BibItem[] = []) {
		this.context = {
			itemMap: new Map<string, number>(),
			citations: [],
			bibDb,
			listInstanceCounter: 0,
		};
	}

	public async parse(tokens: Token[]): Promise<DocxElement[]> {
		this.assignNumbers(tokens);
		return this.processTokens(tokens);
	}

	private assignNumbers(tokens: Token[]) {
		let figCounter = 0;
		let tabCounter = 0;

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
						/^(?:Рисунок|Рис\.)\s+(@fig:[a-zA-Z0-9_-]+)/,
					);
					if (figMatch && !this.context.itemMap.has(figMatch[1])) {
						figCounter++;
						this.context.itemMap.set(figMatch[1], figCounter);
					}

					const tabMatch = text.match(
						/^Таблица\s+(@tab:[a-zA-Z0-9_-]+)/,
					);
					if (tabMatch && !this.context.itemMap.has(tabMatch[1])) {
						tabCounter++;
						this.context.itemMap.set(tabMatch[1], tabCounter);
					}

					const blockMathMatch = text.match(/^\$\$[\s\S]+\$\$/);
					if (blockMathMatch) {
						const eqMatch = text.match(/\((@eq:[a-zA-Z0-9_-]+)\)/);
						if (eqMatch && !this.context.itemMap.has(eqMatch[1])) {
							this.context.itemMap.set(eqMatch[1], 0);
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
							token as StoFlagToken,
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
							style: `Heading${globalThis.Math.min(headingToken.depth, 6)}`,
							children: [
								new TextRun(
									this.replaceRefs(headingToken.text.trim()),
								),
							],
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

	const parser = new MarkdownParser(bibDb);
	return parser.parse(tokens);
}
