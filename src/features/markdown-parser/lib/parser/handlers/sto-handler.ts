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
		const upperText = text.toUpperCase();

		// Convert to Sentence Case: first letter capitalized, rest lowercase
		// This ensures they look correct in TOC, while StructuralHeading style handles caps in the document body
		const sentenceCaseText =
			text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

		const noTocHeadings = ['РЕФЕРАТ', 'СОДЕРЖАНИЕ'];
		const useNoTocStyle = noTocHeadings.includes(upperText);

		const result: DocxElement[] = [
			new Paragraph({
				style: useNoTocStyle
					? 'StructuralHeadingNoTOC'
					: 'StructuralHeading',
				children: [new TextRun(sentenceCaseText)],
			}),
		];

		if (upperText === 'СОДЕРЖАНИЕ') {
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
					throw new Error(
						`СТО violation: Citation source not found in bibliography for key: "${citKey}". Ensure the key exists in references.bib.`,
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
