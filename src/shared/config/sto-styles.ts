import {
	AlignmentType,
	INumberingOptions,
	IStylesOptions,
	LeaderType,
	TabStopType,
} from 'docx';

import {
	createNumberedHeadingStyle,
	HEADING_NUMBERING_REFERENCE,
	NUMBERED_HEADING_STYLE_IDS,
} from './sto-heading-styles';
import { STO_RULES } from './sto-rules';

export {
	getNumberedHeadingStyleId,
	HEADING_NUMBERING_REFERENCE,
	NUMBERED_HEADING_STYLE_IDS,
} from './sto-heading-styles';

const TYPOGRAPHY = STO_RULES.typography;
const NESTED_LIST_INDENT = TYPOGRAPHY.nestedListIndentStepDxa;
const TOC_RIGHT_TAB_STOP = TYPOGRAPHY.tocRightTabStopDxa;
const TOC_LEVEL_INDENTS = TYPOGRAPHY.tocLevelIndentsDxa;
const BIBLIOGRAPHY_PARAGRAPH = STO_RULES.bibliography.paragraph;

export const STRUCTURAL_HEADING_STYLE_ID = 'StructuralHeading';
export const STRUCTURAL_HEADING_NO_TOC_STYLE_ID = 'StructuralHeadingNoTOC';
export const STO_STYLE_PRESET_NAMES = [
	'samara-template-2022',
	'default',
] as const;
export const DEFAULT_STO_STYLE_PRESET = 'samara-template-2022';

export type StoStylePreset = (typeof STO_STYLE_PRESET_NAMES)[number];

type ParagraphStyle = NonNullable<IStylesOptions['paragraphStyles']>[number];

const SAMARA_TEMPLATE_2022_STYLE_NAMES: Record<string, string> = {
	Normal: '+Абзац с отступом 1-ой строки',
	[STRUCTURAL_HEADING_STYLE_ID]: '+ЗАГОЛОВОК по центру',
	[STRUCTURAL_HEADING_NO_TOC_STYLE_ID]: '+ЗаголРеферСодерж',
	FigureCaption: '+№ - Название рисунка',
	TableCaption: '+№ - Название таблицы',
	TableText: '+Текст в таблице',
	TitlePageText: '+Тит_Абзац по центру',
	TOC1: '+Оглавление 1',
	TOC2: '+Оглавление 2',
	TOC3: '+Оглавление 3',
	TOC4: '+Оглавление 4',
	StoHeading1: '+Заголовок 1 уровня',
	StoHeading2: '+Заголовок 2 уровня',
	StoHeading3: '+Заголовок 3 уровня',
	StoHeading4: '+Заголовок 4 уровня',
	StoHeading5: 'heading 5',
	StoHeading6: 'heading 6',
};

export function isStoStylePreset(value: unknown): value is StoStylePreset {
	return (
		typeof value === 'string' &&
		STO_STYLE_PRESET_NAMES.includes(value as StoStylePreset)
	);
}

function getSamaraTemplate2022StyleName(styleId: string): string | undefined {
	return SAMARA_TEMPLATE_2022_STYLE_NAMES[styleId];
}

function applySamaraTemplate2022StyleNames(
	style: ParagraphStyle,
): ParagraphStyle {
	const presetName = getSamaraTemplate2022StyleName(style.id);
	return presetName ? { ...style, name: presetName } : style;
}

function createTocStyle(level: number) {
	return {
		id: `TOC${level}`,
		name: `toc ${level}`,
		basedOn: level === 1 ? 'Normal' : 'TOC1',
		next: 'Normal',
		paragraph: {
			alignment: AlignmentType.LEFT,
			indent: { left: TOC_LEVEL_INDENTS[level - 1] ?? 0, firstLine: 0 },
			tabStops: [
				{
					type: TabStopType.RIGHT,
					position: TOC_RIGHT_TAB_STOP,
					leader: LeaderType.DOT,
				},
			],
		},
	};
}

export const MARGINS = { ...STO_RULES.page.marginsDxa };

export const STO_STYLES: IStylesOptions = {
	default: {
		document: {
			run: {
				font: TYPOGRAPHY.fontFamily,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				color: TYPOGRAPHY.fontColor,
				language: { value: 'ru-RU' },
			},
			paragraph: {
				spacing: {
					line: TYPOGRAPHY.normalLineSpacingDxa,
					lineRule: 'auto',
				},
				alignment: AlignmentType.JUSTIFIED,
			},
		},
	},
	paragraphStyles: [
		{
			id: 'Normal',
			name: 'Normal',
			run: {
				font: TYPOGRAPHY.fontFamily,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				color: TYPOGRAPHY.fontColor,
			},
			paragraph: {
				spacing: {
					line: TYPOGRAPHY.normalLineSpacingDxa,
					lineRule: 'auto',
					before: 0,
					after: 0,
				},
				alignment: AlignmentType.JUSTIFIED,
				indent: { firstLine: TYPOGRAPHY.firstLineIndentDxa },
			},
		},
		createNumberedHeadingStyle(1),
		{
			id: STRUCTURAL_HEADING_STYLE_ID,
			name: 'Structural Heading',
			basedOn: 'Normal',
			next: 'Normal',
			quickFormat: true,
			run: {
				bold: true,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				allCaps: true,
			},
			paragraph: {
				spacing: {
					before: 0,
					after: 120,
					line: TYPOGRAPHY.normalLineSpacingDxa,
					lineRule: 'auto',
				},
				alignment: AlignmentType.CENTER,
				indent: { firstLine: 0 },
				outlineLevel: 0,
				// @ts-expect-error missing type in docx library for some properties
				pageBreakBefore: true,
			},
		},
		{
			id: STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
			name: 'Structural Heading No TOC',
			basedOn: 'TitlePageText',
			next: 'Normal',
			quickFormat: true,
			run: {
				bold: true,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				allCaps: true,
			},
			paragraph: {
				spacing: {
					before: 0,
					after: 240,
					line: TYPOGRAPHY.captionLineSpacingDxa,
					lineRule: 'auto',
				},
				alignment: AlignmentType.CENTER,
				indent: { firstLine: 0 },
				// @ts-expect-error missing type in docx library for some properties
				pageBreakBefore: true,
			},
		},
		...NUMBERED_HEADING_STYLE_IDS.slice(1).map((_, index) =>
			createNumberedHeadingStyle(index + 2),
		),
		{
			id: 'FigureCaption',
			name: 'Figure Caption',
			basedOn: 'Normal',
			next: 'Normal',
			run: { size: TYPOGRAPHY.fontSizeHalfPoints },
			paragraph: {
				alignment: AlignmentType.CENTER,
				indent: { firstLine: TYPOGRAPHY.captionFirstLineIndentDxa },
				spacing: {
					before: 120,
					after: 240,
					line: TYPOGRAPHY.captionLineSpacingDxa,
					lineRule: 'auto',
				}, // Single spacing, 6pt before, 12pt after
				keepLines: true,
			},
		},
		{
			id: 'TableCaption',
			name: 'Table Caption',
			basedOn: 'Normal',
			next: 'Normal',
			run: { size: TYPOGRAPHY.fontSizeHalfPoints },
			paragraph: {
				alignment: AlignmentType.LEFT,
				indent: { firstLine: TYPOGRAPHY.captionFirstLineIndentDxa },
				spacing: {
					before: 120,
					after: 120,
					line: TYPOGRAPHY.captionLineSpacingDxa,
					lineRule: 'auto',
				}, // Single spacing, 6pt before, 6pt after
				keepNext: true,
				keepLines: true,
			},
		},
		{
			id: 'TableText',
			name: 'Table Text',
			basedOn: 'Normal',
			next: 'Normal',
			run: { size: TYPOGRAPHY.fontSizeHalfPoints },
			paragraph: {
				alignment: AlignmentType.LEFT,
				indent: { firstLine: 0 },
				spacing: {
					before: 0,
					after: 0,
					line: TYPOGRAPHY.captionLineSpacingDxa,
					lineRule: 'auto',
				}, // Single spacing
			},
		},
		{
			id: 'TitlePageText',
			name: 'Title Page Text',
			basedOn: 'Normal',
			run: { size: TYPOGRAPHY.fontSizeHalfPoints },
			paragraph: {
				alignment: AlignmentType.CENTER,
				indent: { firstLine: 0 },
				spacing: {
					before: 0,
					after: 0,
					line: TYPOGRAPHY.captionLineSpacingDxa,
					lineRule: 'auto',
				},
			},
		},
		...TOC_LEVEL_INDENTS.map((_, index) => createTocStyle(index + 1)),
	],
};

export function getStoStyles(
	stylePreset: StoStylePreset = DEFAULT_STO_STYLE_PRESET,
): IStylesOptions {
	if (stylePreset === 'default') {
		return STO_STYLES;
	}

	return {
		...STO_STYLES,
		paragraphStyles: STO_STYLES.paragraphStyles?.map(
			applySamaraTemplate2022StyleNames,
		),
	};
}

export function getStoStylePresetDisplayNames(
	stylePreset: StoStylePreset,
): Record<string, string> {
	return stylePreset === 'samara-template-2022'
		? { ...SAMARA_TEMPLATE_2022_STYLE_NAMES }
		: {};
}

export const STO_NUMBERING: INumberingOptions = {
	config: [
		{
			reference: HEADING_NUMBERING_REFERENCE,
			levels: NUMBERED_HEADING_STYLE_IDS.map((_, index) => ({
				level: index,
				format: 'decimal',
				text: Array.from(
					{ length: index + 1 },
					(__, levelIndex) => `%${levelIndex + 1}`,
				).join('.'),
				alignment: AlignmentType.LEFT,
				style: {
					paragraph: {
						indent: {
							left: 0,
							firstLine: TYPOGRAPHY.firstLineIndentDxa,
						},
					},
				},
				suffix: 'space',
			})),
		},
		{
			reference: 'main-numbering',
			levels: [
				{
					level: 0,
					format: 'decimal',
					text: '%1.',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: BIBLIOGRAPHY_PARAGRAPH.leftIndentDxa,
								hanging:
									BIBLIOGRAPHY_PARAGRAPH.hangingIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
			],
		},
		{
			reference: 'bib-numbering',
			levels: [
				{
					level: 0,
					format: 'decimal',
					text: '%1', // STO: no dot after bibliography number
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: BIBLIOGRAPHY_PARAGRAPH.leftIndentDxa,
								hanging:
									BIBLIOGRAPHY_PARAGRAPH.hangingIndentDxa,
							},
						},
					},
					suffix: 'tab',
				},
			],
		},
		{
			reference: 'list-numbering',
			levels: [
				{
					level: 0,
					format: 'bullet',
					text: TYPOGRAPHY.listMarker, // STO: hyphen (дефис) for lists
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: 0,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
				{
					level: 1,
					format: 'russianLower', // STO: lowercase letters a, b, c
					text: '%2)',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: NESTED_LIST_INDENT,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
				{
					level: 2,
					format: 'decimal', // STO: decimal numbers 1) 2) 3)
					text: '%3)',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: NESTED_LIST_INDENT * 2,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
			],
		},
		{
			reference: 'ordered-numbering',
			levels: [
				{
					level: 0,
					format: 'decimal',
					text: '%1.',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: 0,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
				{
					level: 1,
					format: 'decimal',
					text: '%2)',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: NESTED_LIST_INDENT,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
				{
					level: 2,
					format: 'russianLower',
					text: '%3)',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: {
								left: NESTED_LIST_INDENT * 2,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
				},
			],
		},
	],
};
