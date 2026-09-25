import { AlignmentType, IStylesOptions } from 'docx';

import { STO_RULES } from './sto-rules';

const TYPOGRAPHY = STO_RULES.typography;

export const APPENDIX_STYLES: NonNullable<IStylesOptions['paragraphStyles']> = [
	{
		id: 'AppendixHeading',
		name: 'Appendix Heading',
		basedOn: 'Normal',
		next: 'Normal',
		run: { bold: true, size: TYPOGRAPHY.fontSizeHalfPoints },
		paragraph: {
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0 },
			spacing: {
				before: 0,
				after: 120,
				line: TYPOGRAPHY.normalLineSpacingDxa,
				lineRule: 'auto',
			},
			// @ts-expect-error docx accepts this OOXML paragraph property but omits it from the public style type.
			pageBreakBefore: true,
			keepNext: true,
		},
	},
	{
		id: 'AppendixSectionHeading',
		name: 'Appendix Section Heading',
		basedOn: 'Normal',
		next: 'Normal',
		run: { bold: true, size: TYPOGRAPHY.fontSizeHalfPoints },
		paragraph: {
			alignment: AlignmentType.LEFT,
			spacing: {
				before: 0,
				after: 120,
				line: TYPOGRAPHY.normalLineSpacingDxa,
				lineRule: 'auto',
			},
			outlineLevel: 1,
			keepNext: true,
		},
	},
];
