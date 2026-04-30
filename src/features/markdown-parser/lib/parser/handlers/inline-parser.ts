import { convertLatex2Math } from '@hungknguyen/docx-math-converter';
import { TextRun } from 'docx';
import { Token, Tokens } from 'marked';

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
				runs.push(...(await handleImage(token as Tokens.Image)));
				break;
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
				if ('text' in token) {
					runs.push(
						new TextRun({
							text: replaceRefs((token as Tokens.Text).text),
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

	// Process citations [@key]
	text = text.replace(/\[@([^\]]+)\]/g, (_: string, key: string) => {
		return `[${getCitationNum(key)}]`;
	});

	// Replace references @fig:key, etc.
	text = replaceRefs(text);

	// Process inline math $...$
	const mathParts = text.split(/(\$[^$]+\$)/g);
	for (const part of mathParts) {
		if (part.startsWith('$') && part.endsWith('$')) {
			const mathText = part.substring(1, part.length - 1);
			try {
				const mathEl = await convertLatex2Math(mathText);
				runs.push(mathEl as MathConversionResult);
			} catch {
				runs.push(new TextRun({ text: part, italics: true }));
			}
		} else if (part.length > 0) {
			runs.push(new TextRun({ text: part }));
		}
	}
	return runs;
}
