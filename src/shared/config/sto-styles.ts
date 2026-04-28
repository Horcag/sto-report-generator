import { AlignmentType, IStylesOptions, INumberingOptions } from 'docx';
import { MM_TO_DXA } from '@/shared/lib';

export const MARGINS = {
	top: Math.round(20 * MM_TO_DXA), // 20 mm
	bottom: Math.round(20 * MM_TO_DXA), // 20 mm
	left: Math.round(30 * MM_TO_DXA), // 30 mm
	right: Math.round(15 * MM_TO_DXA), // 15 mm
};

export const STO_STYLES: IStylesOptions = {
	default: {
		document: {
			run: {
				font: 'Times New Roman',
				size: 28, // 14pt (28 half-points)
				color: '000000',
			},
			paragraph: {
				spacing: { line: 360, lineRule: 'auto' }, // 1.5 spacing
				alignment: AlignmentType.JUSTIFIED,
			},
		},
	},
	paragraphStyles: [
		{
			id: 'Normal',
			name: 'Normal',
			run: {
				font: 'Times New Roman',
				size: 28,
				color: '000000',
			},
			paragraph: {
				spacing: { line: 360, lineRule: 'auto', before: 0, after: 0 },
				alignment: AlignmentType.JUSTIFIED,
				indent: { firstLine: 709 }, // 1.25 cm
			},
		},
		{
		        id: 'Heading1',
		        name: 'Heading 1',
		        basedOn: 'Normal',
		        next: 'Normal',
		        quickFormat: true,
		        run: { bold: true, size: 28 },
		        paragraph: {
		                spacing: { before: 120, after: 120 }, // 6pt before and after
		                alignment: AlignmentType.LEFT, // STO: numbered headings left-aligned (with indent)
		                indent: { firstLine: 709 }, // STO: paragraph indent
		                outlineLevel: 0,
		                // @ts-ignore
		                pageBreakBefore: true,
		        },
		},
		{
		        id: 'StructuralHeading',
		        name: 'Structural Heading',
		        basedOn: 'Heading1',
		        next: 'Normal',
		        quickFormat: true,
		        run: { bold: true, size: 28 },
		        paragraph: {
		                spacing: { before: 120, after: 240 }, // 12pt after
		                alignment: AlignmentType.CENTER, // STO: unnumbered structural headings are centered
		                indent: { firstLine: 0 },
		                outlineLevel: 0,
		                // @ts-ignore
		                pageBreakBefore: true,
		        },
		},
		{
		        id: 'Heading2',
		        name: 'Heading 2',
		        basedOn: 'Normal',
		        next: 'Normal',
		        quickFormat: true,
		        run: { bold: true, size: 28 },
		        paragraph: {
		                spacing: { before: 200, after: 0 }, // 0pt after
		                alignment: AlignmentType.LEFT,
		                indent: { firstLine: 709 },
		                outlineLevel: 1,
		                // @ts-ignore
		                pageBreakBefore: false,
		        },
		},
		{
		        id: 'FigureCaption',
		        name: 'Figure Caption',
		        basedOn: 'Normal',
		        next: 'Normal',
		        run: { size: 28 },
		        paragraph: {
		                alignment: AlignmentType.CENTER,
		                indent: { firstLine: 0 },
		                spacing: { before: 120, after: 240, line: 240, lineRule: 'auto' }, // Single spacing, 6pt before, 12pt after
		        },
		},
		{
		        id: 'TableCaption',
		        name: 'Table Caption',
		        basedOn: 'Normal',
		        next: 'Normal',
		        run: { size: 28 },
		        paragraph: {
		                alignment: AlignmentType.LEFT,
		                indent: { firstLine: 0 },
		                spacing: { before: 120, after: 120, line: 240, lineRule: 'auto' }, // Single spacing, 6pt before, 6pt after
		        },
		},
		{
		        id: 'TableText',
		        name: 'Table Text',
		        basedOn: 'Normal',
		        next: 'Normal',
		        run: { size: 28 },
		        paragraph: {
		                alignment: AlignmentType.LEFT,
		                indent: { firstLine: 0 },
		                spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' }, // Single spacing
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
				rightTabStop: 9026
			}
		},
		{
			id: 'TOC2',
			name: 'toc 2',
			basedOn: 'Normal',
			next: 'Normal',
			paragraph: {
				indent: { left: 200, firstLine: 0 },
				rightTabStop: 9026
			}
		}
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
							indent: { left: 0, firstLine: 709 },
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
							indent: { left: 0, firstLine: 709 },
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
					text: '-', // STO: hyphen (дефис) for lists
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: { left: 0, firstLine: 709 },
						},
					},
					suffix: 'space',
				},
				{
					level: 1,
					format: 'lowerLetter',
					text: '%2)',
					alignment: AlignmentType.LEFT,
					style: {
						paragraph: {
							indent: { left: 0, firstLine: 1069 }, // Slightly indented
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
							indent: { left: 0, firstLine: 709 },
						},
					},
					suffix: 'space',
				},
			],
		},
	],
};