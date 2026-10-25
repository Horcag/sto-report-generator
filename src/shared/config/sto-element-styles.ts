import { AlignmentType, IStylesOptions } from 'docx';

import { STO_RULES } from './sto-rules';

/** Portable named counterparts of semantic formatting used by the parser. */
export const ELEMENT_STYLES: NonNullable<IStylesOptions['paragraphStyles']> = [
	{
		id: 'TableTextCenter',
		name: '+Текст в таблице + По центру',
		basedOn: 'TableText',
		paragraph: { alignment: AlignmentType.CENTER },
	},
	{
		id: 'TableTextRight',
		name: '+Текст в таблице + По правому краю',
		basedOn: 'TableText',
		paragraph: { alignment: AlignmentType.RIGHT },
	},
	{
		id: 'TableNote',
		name: '+Примечание в таблице',
		basedOn: 'TableText',
		paragraph: {
			alignment: AlignmentType.LEFT,
			indent: { firstLine: STO_RULES.typography.firstLineIndentDxa },
		},
	},
	{
		id: 'Figure',
		name: '+Рисунок по центру',
		basedOn: 'Normal',
		paragraph: {
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0 },
			keepNext: true,
		},
	},
	{
		id: 'CenteredParagraph',
		name: 'Centered Paragraph',
		basedOn: 'Normal',
		paragraph: {
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0 },
		},
	},
	{
		id: 'TableFollowingText',
		name: '+Абзац после таблицы',
		basedOn: 'Normal',
		paragraph: { spacing: { before: 120 } },
	},
	{
		id: 'ReferatKeywords',
		name: 'Referat Keywords',
		basedOn: 'Normal',
		run: { allCaps: true },
		paragraph: {
			spacing: {
				before: STO_RULES.referat.keywordParagraph.spacingBeforeDxa,
				after: STO_RULES.referat.keywordParagraph.spacingAfterDxa,
			},
		},
	},
	{
		id: 'Bibliography',
		name: 'Bibliography',
		basedOn: 'Normal',
		paragraph: {
			numbering: { reference: 'bib-numbering', level: 0 },
		},
	},
	{
		id: 'ListParagraph',
		name: 'List Paragraph',
		basedOn: 'Normal',
	},
	{
		id: 'Formula',
		name: 'Display Equation',
		basedOn: 'Normal',
		paragraph: {
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0, left: 0, right: 0 },
			spacing: { before: 0, after: 0, line: 240 },
		},
	},
	{
		id: 'TitlePageTopic',
		name: 'Title Page Topic',
		basedOn: 'TitlePageText',
		run: { bold: true, size: 32 },
	},
];
