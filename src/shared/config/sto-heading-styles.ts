import { AlignmentType, IStylesOptions } from 'docx';

import { STO_RULES } from './sto-rules';

type ParagraphStyle = NonNullable<IStylesOptions['paragraphStyles']>[number];

export const NUMBERED_HEADING_STYLE_IDS = [
	'StoHeading1',
	'StoHeading2',
	'StoHeading3',
	'StoHeading4',
	'StoHeading5',
	'StoHeading6',
] as const;
export const HEADING_NUMBERING_REFERENCE = 'heading-numbering';

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

export function createNumberedHeadingStyle(level: number): ParagraphStyle {
	const typography = STO_RULES.typography;
	return {
		id: getNumberedHeadingStyleId(level),
		name: `STO Heading ${level}`,
		basedOn: 'Normal',
		next: 'Normal',
		quickFormat: true,
		run: { bold: true, size: typography.fontSizeHalfPoints },
		paragraph: {
			spacing: {
				before: 0,
				after: level === 1 ? 120 : 0,
				line: typography.normalLineSpacingDxa,
				lineRule: 'auto',
			},
			alignment: AlignmentType.LEFT,
			indent: { firstLine: typography.firstLineIndentDxa },
			outlineLevel: level - 1,
			keepNext: true,
			keepLines: true,
			numbering: {
				reference: HEADING_NUMBERING_REFERENCE,
				level: level - 1,
			},
			...(level === 1 ? { pageBreakBefore: true } : {}),
		},
	};
}
