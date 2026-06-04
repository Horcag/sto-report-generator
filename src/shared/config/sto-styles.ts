import {
	AlignmentType,
	INumberingOptions,
	IStylesOptions,
	LeaderType,
	TabStopType,
} from 'docx';

import { STO_RULES } from './sto-rules';

const TYPOGRAPHY = STO_RULES.typography;
const NESTED_LIST_INDENT = TYPOGRAPHY.nestedListIndentStepDxa;

export const NUMBERED_HEADING_STYLE_IDS = [
	'StoHeading1',
	'StoHeading2',
	'StoHeading3',
	'StoHeading4',
	'StoHeading5',
	'StoHeading6',
] as const;
export const STRUCTURAL_HEADING_STYLE_ID = 'StructuralHeading';
export const STRUCTURAL_HEADING_NO_TOC_STYLE_ID = 'StructuralHeadingNoTOC';

export function getNumberedHeadingStyleId(depth: number): string {
	const normalizedDepth = globalThis.Math.min(
		globalThis.Math.max(globalThis.Math.trunc(depth), 1),
		NUMBERED_HEADING_STYLE_IDS.length,
	);
	return (
		NUMBERED_HEADING_STYLE_IDS[normalizedDepth - 1] ??
		NUMBERED_HEADING_STYLE_IDS[0]
	);
}

function createNumberedHeadingStyle(level: number) {
	return {
		id: getNumberedHeadingStyleId(level),
		name: `STO Heading ${level}`,
		basedOn: 'Normal',
		next: 'Normal',
		quickFormat: true,
		run: { bold: true, size: TYPOGRAPHY.fontSizeHalfPoints },
		paragraph: {
			spacing:
				level === 1
					? { before: 120, after: 120 }
					: { before: 200, after: 0 },
			alignment: AlignmentType.LEFT,
			indent: { firstLine: TYPOGRAPHY.firstLineIndentDxa },
			outlineLevel: level - 1,
			...(level === 1 ? { pageBreakBefore: true } : {}),
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
				language: { value: 'ru-RU' }, // Set language for native 'lowerLetter' numbering
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
			basedOn: getNumberedHeadingStyleId(1),
			next: 'Normal',
			quickFormat: true,
			run: {
				bold: true,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				allCaps: true,
			},
			paragraph: {
				spacing: { before: 120, after: 240 }, // 12pt after
				alignment: AlignmentType.CENTER, // STO: unnumbered structural headings are centered
				indent: { firstLine: 0 },
				outlineLevel: 0,
				// @ts-expect-error missing type in docx library for some properties
				pageBreakBefore: true,
			},
		},
		{
			id: STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
			name: 'Structural Heading No TOC',
			basedOn: 'Normal',
			next: 'Normal',
			quickFormat: true,
			run: {
				bold: true,
				size: TYPOGRAPHY.fontSizeHalfPoints,
				allCaps: true,
			},
			paragraph: {
				spacing: { before: 120, after: 240 }, // 12pt after
				alignment: AlignmentType.CENTER, // STO: unnumbered structural headings are centered
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
			run: { size: 24 }, // 12pt
			paragraph: {
				alignment: AlignmentType.CENTER,
				indent: { firstLine: 0 },
				spacing: { before: 0, after: 0 },
			},
		},
		{
			id: 'TOC1',
			name: 'toc 1',
			basedOn: 'Normal',
			next: 'Normal',
			paragraph: {
				indent: { left: 0, firstLine: 0 },
				// @ts-expect-error missing type in docx library for style tab stops
				tabStops: [
					{
						type: TabStopType.RIGHT,
						position: 9026,
						leader: LeaderType.DOT, // "dot" usually maps correctly, or cast as any if enum is needed
					},
				],
			},
		},
		{
			id: 'TOC2',
			name: 'toc 2',
			basedOn: 'Normal',
			next: 'Normal',
			paragraph: {
				indent: { left: 200, firstLine: 0 },
				// @ts-expect-error missing type in docx library for style tab stops
				tabStops: [
					{
						type: TabStopType.RIGHT,
						position: 9026,
						leader: LeaderType.DOT,
					},
				],
			},
		},
	],
};

export const STO_NUMBERING: INumberingOptions = {
	config: [
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
								left: 0,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
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
								left: 0,
								firstLine: TYPOGRAPHY.firstLineIndentDxa,
							},
						},
					},
					suffix: 'space',
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
