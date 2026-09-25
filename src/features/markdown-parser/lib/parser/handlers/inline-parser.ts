import { TextRun } from 'docx';
import { Token, Tokens } from 'marked';

import { parseCitationReferences } from '@/shared/lib/citation-syntax';
import { convertLatex2Math } from '@/shared/lib/math-converter';

import {
	InlineDocxElement,
	MathConversionResult,
	ParserContext,
} from '../../types';
import { handleImage } from './image-handler';

export interface ParseInlineOptions {
	bold?: boolean;
	allowBold?: boolean;
}

/**
 * Parses inline tokens (text, math, images, links) into Docx TextRuns and ImageRuns.
 */
export async function parseInline(
	inlineTokens: Token[],
	context: ParserContext,
	getCitationNum: (key: string) => number,
	replaceRefs: (text: string) => string,
	options?: ParseInlineOptions,
): Promise<InlineDocxElement[]> {
	const runs: InlineDocxElement[] = [];

	for (const token of inlineTokens) {
		switch (token.type) {
			case 'strong': {
				if (options?.allowBold || options?.bold) {
					const strongToken = token as Tokens.Strong;
					if (strongToken.tokens && strongToken.tokens.length > 0) {
						runs.push(
							...(await parseInline(
								strongToken.tokens,
								context,
								getCitationNum,
								replaceRefs,
								{ ...options, bold: true },
							)),
						);
					} else {
						runs.push(
							new TextRun({
								text: replaceRefs(strongToken.text),
								bold: true,
							}),
						);
					}
					break;
				}
				throw new Error(
					`СТО violation: Bold text is forbidden in regular text. Use TeX math ($\\mathbf{...}$) for vectors/matrices instead. Found bold text: "${(token as Tokens.Strong).text}"`,
				);
			}
			case 'em':
				runs.push(
					new TextRun({
						text: replaceRefs((token as Tokens.Em).text),
						italics: true,
						bold: options?.bold ? true : undefined,
					}),
				);
				break;
			case 'codespan':
				runs.push(
					new TextRun({
						text: (token as Tokens.Codespan).text,
						font: 'Courier New',
						bold: options?.bold ? true : undefined,
					}),
				);
				break;
			case 'escape':
				runs.push(
					new TextRun({
						text: (token as Tokens.Escape).text,
						bold: options?.bold ? true : undefined,
					}),
				);
				break;
			case 'html': {
				const rawHtml = (token as Tokens.HTML).raw.trim();
				if (/^<br\s*\/?>$/i.test(rawHtml)) {
					runs.push(new TextRun({ break: 1 }));
				}
				break;
			}
			case 'image':
				runs.push(
					...(await handleImage(token as Tokens.Image, context)),
				);
				break;
			case 'math': {
				const mathToken = token as Token & {
					raw: string;
					text: string;
				};
				const mathEl = convertLatex2Math(mathToken.text);
				runs.push(mathEl as unknown as MathConversionResult);
				break;
			}
			case 'text': {
				const textToken = token as Tokens.Text;
				if (textToken.tokens && textToken.tokens.length > 0) {
					runs.push(
						...(await parseInline(
							textToken.tokens,
							context,
							getCitationNum,
							replaceRefs,
							options,
						)),
					);
				} else {
					runs.push(
						...(await handleText(
							textToken,
							context,
							getCitationNum,
							replaceRefs,
							options,
						)),
					);
				}
				break;
			}
			default:
				if ('text' in token && token.raw) {
					const rawToken = token.raw;
					if (/^<br\s*\/?>$/i.test(rawToken.trim())) {
						runs.push(new TextRun({ break: 1 }));
					} else {
						runs.push(
							new TextRun({
								text: replaceRefs(rawToken),
								bold: options?.bold ? true : undefined,
							}),
						);
					}
				}
				break;
		}
	}
	return runs;
}

/**
 * Handles plain text tokens, processes citations and inline math.
 */
async function handleText(
	token: Tokens.Text | Tokens.Tag,
	_context: ParserContext,
	getCitationNum: (key: string) => number,
	replaceRefs: (text: string) => string,
	options?: ParseInlineOptions,
): Promise<InlineDocxElement[]> {
	const runs: InlineDocxElement[] = [];
	let text = token.raw
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

	// Numbered end-reference calls, optionally with a page locator.
	text = text.replace(/\[@([^\]]*)\]/g, (_: string, keysRaw: string) => {
		const references = parseCitationReferences(keysRaw);
		const calls = references.map(
			({ key, page }) =>
				`${getCitationNum(key)}${page ? `, ${page}` : ''}`,
		);
		return `[${calls.join(references.some(ref => ref.page) ? '; ' : ', ')}]`;
	});

	// Replace references @fig:key, etc.
	text = replaceRefs(text);

	if (
		text.includes('<br>') ||
		text.includes('<br/>') ||
		text.includes('<br />')
	) {
		const parts = text.split(/(<br\s*\/?>)/gi);
		for (const part of parts) {
			if (/^<br\s*\/?>$/i.test(part)) {
				runs.push(new TextRun({ break: 1 }));
			} else if (part.length > 0) {
				runs.push(
					new TextRun({
						text: part,
						bold: options?.bold ? true : undefined,
					}),
				);
			}
		}
	} else if (text.length > 0) {
		runs.push(
			new TextRun({
				text: text,
				bold: options?.bold ? true : undefined,
			}),
		);
	}

	return runs;
}
