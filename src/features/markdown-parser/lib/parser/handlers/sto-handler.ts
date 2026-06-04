import { Paragraph, StyleLevel, TableOfContents, TextRun } from 'docx';
import { Token } from 'marked';

import {
	NUMBERED_HEADING_STYLE_IDS,
	STO_LIST_ENVIRONMENTS,
	STO_RULES,
	STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	STRUCTURAL_HEADING_STYLE_ID,
} from '@/shared/config';

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
	_currentContext: ProcessTokensContext,
): Promise<DocxElement[]> {
	if (token.flagType === 'structural_heading') {
		if (!token.text) {
			throw new Error('STO structural heading token is missing text.');
		}
		const text = token.text.trim();
		const upperText = text.toUpperCase();

		// Convert to Sentence Case: first letter capitalized, rest lowercase
		// This ensures they look correct in TOC, while StructuralHeading style handles caps in the document body
		const sentenceCaseText =
			text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

		const useNoTocStyle =
			STO_RULES.headings.structuralNoTocUppercase.includes(upperText);
		const tocStyles = [
			new StyleLevel(STRUCTURAL_HEADING_STYLE_ID, 1),
			...NUMBERED_HEADING_STYLE_IDS.slice(0, 4).map(
				(styleId, index) => new StyleLevel(styleId, index + 1),
			),
		];

		const result: DocxElement[] = [
			new Paragraph({
				style: useNoTocStyle
					? STRUCTURAL_HEADING_NO_TOC_STYLE_ID
					: STRUCTURAL_HEADING_STYLE_ID,
				children: [new TextRun(sentenceCaseText)],
			}),
		];

		if (upperText === 'СОДЕРЖАНИЕ') {
			result.push(
				new TableOfContents('', {
					hyperlink: true,
					headingStyleRange: '1-4',
					stylesWithLevels: tocStyles,
				}),
			);
		}
		return result;
	}

	if (token.flagType === 'environment') {
		const envName = token.envName;
		if (!envName) {
			throw new Error('STO environment token is missing envName.');
		}

		if (envName === STO_RULES.markdown.bibliographyEnvironment) {
			const bibElements: Paragraph[] = [];
			for (const citKey of context.citations) {
				const item = context.bibDb.find(b => b.citationKey === citKey);
				if (item) {
					const text = formatBibItem(item);
					bibElements.push(
						new Paragraph({
							style: 'Normal',
							indent: {
								left: 0,
								firstLine:
									STO_RULES.typography.firstLineIndentDxa,
							},
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

		if (STO_LIST_ENVIRONMENTS.has(envName)) {
			context.listInstanceCounter++;
			return processTokens(token.tokens, {
				isStoList: true,
				listType: envName === 'sto_enum' ? 'ordered' : 'bullet',
				instance: context.listInstanceCounter,
			});
		}

		throw new Error(
			`Unsupported STO environment: ${envName}. Supported environments: ${STO_RULES.markdown.supportedEnvironments.join(', ')}.`,
		);
	}
	return [];
}
