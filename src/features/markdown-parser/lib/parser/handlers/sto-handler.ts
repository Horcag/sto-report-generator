import { Paragraph, StyleLevel, TableOfContents, TextRun } from 'docx';
import { Token } from 'marked';

import {
	DocxElement,
	ParserContext,
	ProcessTokensContext,
	StoFlagToken,
} from '../../types';
import { formatBibItem } from '../../utils/bib-formatter';

/**
 * Handles STO-specific flags like structural headings and bibliography.
 */
export async function handleStoFlag(
	token: StoFlagToken,
	context: ParserContext,
	processTokens: (
		tokens: Token[],
		ctx: ProcessTokensContext,
	) => Promise<DocxElement[]>,
	currentContext: ProcessTokensContext,
): Promise<DocxElement[]> {
	if (token.flagType === 'structural_heading') {
		const text = token.text.trim();
		const result: DocxElement[] = [
			new Paragraph({
				style: 'StructuralHeading',
				children: [new TextRun(text)],
			}),
		];
		if (text.toUpperCase() === 'СОДЕРЖАНИЕ') {
			result.push(
				new TableOfContents('', {
					hyperlink: true,
					headingStyleRange: '1-4',
					stylesWithLevels: [new StyleLevel('StructuralHeading', 1)],
				}),
			);
		}
		return result;
	}

	if (token.flagType === 'environment') {
		if (token.envName === 'sto_bibliography') {
			const bibElements: Paragraph[] = [];
			for (const citKey of context.citations) {
				const item = context.bibDb.find(b => b.citationKey === citKey);
				if (item) {
					const text = formatBibItem(item);
					bibElements.push(
						new Paragraph({
							style: 'Normal',
							indent: { left: 0, firstLine: 709 },
							numbering: {
								reference: 'bib-numbering',
								level: 0,
							},
							children: [new TextRun({ text })],
						}),
					);
				} else {
					bibElements.push(
						new Paragraph({
							style: 'Normal',
							indent: { left: 0, firstLine: 709 },
							numbering: {
								reference: 'bib-numbering',
								level: 0,
							},
							children: [
								new TextRun({
									text: `[Источник не найден: ${citKey}]`,
									color: 'FF0000',
								}),
							],
						}),
					);
				}
			}
			return bibElements;
		}

		if (token.envName === 'sto_list' || token.envName === 'sto_enum') {
			context.listInstanceCounter++;
			return processTokens(token.tokens, {
				isStoList: true,
				listType: token.envName === 'sto_enum' ? 'ordered' : 'bullet',
				instance: context.listInstanceCounter,
			});
		}
		return processTokens(token.tokens, currentContext);
	}
	return [];
}
