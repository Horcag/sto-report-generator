import { TextRun } from 'docx';
import { Token, Tokens } from 'marked';

import { convertLatex2Math } from '@/shared/lib/math-converter';

import {
	InlineDocxElement,
	MathConversionResult,
	ParserContext,
} from '../../types';
import { handleImage } from './image-handler';

/**
 * Parses inline tokens (text, math, images, links) into Docx TextRuns and ImageRuns.
 */
export async function parseInline(
	inlineTokens: Token[],
	context: ParserContext,
	getCitationNum: (key: string) => number,
	replaceRefs: (text: string) => string,
): Promise<InlineDocxElement[]> {
	const runs: InlineDocxElement[] = [];

	for (const token of inlineTokens) {
		switch (token.type) {
			case 'strong':
				throw new Error(
					`СТО violation: Bold text is forbidden in regular text. Use TeX math ($\\mathbf{...}$) for vectors/matrices instead. Found bold text: "${(token as Tokens.Strong).text}"`,
				);
			case 'em':
				runs.push(
					new TextRun({
						text: replaceRefs((token as Tokens.Em).text),
						italics: true,
					}),
				);
				break;
			case 'codespan':
				runs.push(
					new TextRun({
						text: replaceRefs((token as Tokens.Codespan).text),
						font: 'Courier New',
					}),
				);
				break;
			case 'escape':
				runs.push(new TextRun({ text: (token as Tokens.Escape).text }));
				break;
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
				try {
					const mathEl = await convertLatex2Math(mathToken.text);
					runs.push(mathEl as unknown as MathConversionResult);
				} catch (e) {
					console.warn(
						`Math conversion failed for: ${mathToken.text}`,
						e,
					);
					runs.push(
						new TextRun({ text: mathToken.raw, italics: true }),
					);
				}
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
						)),
					);
				} else {
					runs.push(
						...(await handleText(
							textToken,
							context,
							getCitationNum,
							replaceRefs,
						)),
					);
				}
				break;
			}
			default:
				if ('text' in token && token.raw) {
					runs.push(
						new TextRun({
							text: replaceRefs(token.raw),
						}),
					);
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
): Promise<InlineDocxElement[]> {
	const runs: InlineDocxElement[] = [];
	let text = token.raw
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

	// Process citations [@key] or [@key1; @key2]
	text = text.replace(/\[@([^\]]+)\]/g, (_: string, keysRaw: string) => {
		const keys = keysRaw.split(/[;,]/).map(k => k.trim().replace(/^@/, ''));
		const nums = keys.map(k => getCitationNum(k));
		return `[${nums.join(', ')}]`;
	});

	// Replace references @fig:key, etc.
	text = replaceRefs(text);

	if (text.length > 0) {
		runs.push(new TextRun({ text: text }));
	}

	return runs;
}
