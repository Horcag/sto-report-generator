import {
	AlignmentType,
	Paragraph,
	StyleLevel,
	Table,
	TableCell,
	TableOfContents,
	TableRow,
	TabStopType,
	TextRun,
} from 'docx';
import { Token } from 'marked';

import {
	compareStoTerms,
	NUMBERED_HEADING_STYLE_IDS,
	parseAppendixHeading,
	parseStoTermLine,
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
import { appendixTocFieldRuns } from './appendix-toc-field';

const URL_PATTERN = /https?:\/\/[^\s)]+/g;
const URL_BREAK_OPPORTUNITY = '\u200B';

function addUrlBreakOpportunities(text: string): string {
	return text.replace(URL_PATTERN, url =>
		url.replace(
			/^(https?:\/\/)(.+)$/i,
			(_match, protocol, rest) =>
				`${protocol}${rest.replace(/([/.?&=#_-])/g, `$1${URL_BREAK_OPPORTUNITY}`)}`,
		),
	);
}

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
	if (token.flagType === 'referat_field') {
		if (currentContext.structuralHeading !== 'РЕФЕРАТ') {
			throw new Error(
				'Referat semantic fields must appear under the РЕФЕРАТ heading.',
			);
		}
		const value = token.text?.trim();
		if (!value) throw new Error('Referat semantic field must be nonempty.');
		return [
			new Paragraph({
				style: 'Normal',
				children: [
					new TextRun({
						text:
							token.referatField === 'characteristics'
								? 'Основные характеристики: '
								: 'Область применения: ',
						bold: true,
					}),
					new TextRun(value),
				],
			}),
		];
	}
	if (token.flagType === 'appendix') {
		if (!token.appendix)
			throw new Error('Appendix token is missing label and title.');
		const appendix = parseAppendixHeading(
			token.appendix.label,
			token.appendix.title,
		);
		return [
			new Paragraph({
				style: 'AppendixHeading',
				children: [
					new TextRun({
						text: `Приложение ${appendix.label}`,
						allCaps: true,
					}),
					new TextRun({
						text: appendix.title,
						break: 1,
						allCaps: false,
					}),
				],
			}),
			new Paragraph({
				children: appendixTocFieldRuns(appendix),
				spacing: { before: 0, after: 0, line: 1, lineRule: 'exact' },
			}),
		];
	}
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
			new StyleLevel('AppendixSectionHeading', 2),
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
					tcFieldIdentifier: 'A',
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
					const docxText = addUrlBreakOpportunities(text);
					bibElements.push(
						new Paragraph({
							style: 'Normal',
							alignment: AlignmentType.JUSTIFIED,
							spacing: {
								before: 0,
								after: 0,
								line: STO_RULES.typography.normalLineSpacingDxa,
								lineRule: 'auto',
							},
							indent: {
								left: 0,
								right: 0,
								firstLine:
									STO_RULES.typography.firstLineIndentDxa,
							},
							tabStops: [
								{
									type: TabStopType.LEFT,
									position:
										STO_RULES.bibliography.paragraph
											.tabStopDxa,
								},
							],
							numbering: {
								reference: 'bib-numbering',
								level: 0,
							},
							children: [new TextRun({ text: docxText })],
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

		if (envName === 'sto_terms') {
			const lines = (token.content ?? '')
				.split(/\r?\n/)
				.map(line => line.trim())
				.filter(Boolean);
			const terms = lines.map(line => parseStoTermLine(line));
			if (terms.length === 0 || terms.some(term => term === null)) {
				throw new Error(
					'sto_terms requires nonempty term | explanation | optional unit rows.',
				);
			}
			const entries = terms as NonNullable<(typeof terms)[number]>[];
			for (let index = 1; index < entries.length; index++) {
				if (
					compareStoTerms(
						entries[index - 1].term,
						entries[index].term,
					) >= 0
				) {
					throw new Error(
						'sto_terms must have unique terms in Russian alphabetical order.',
					);
				}
			}
			return [
				new Table({
					rows: entries.map(
						entry =>
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph({ text: entry.term }),
										],
									}),
									new TableCell({
										children: [
											new Paragraph({
												text: `– ${entry.explanation}${entry.unit ? `, ${entry.unit}` : ''}`,
											}),
										],
									}),
								],
							}),
					),
				}),
			];
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
