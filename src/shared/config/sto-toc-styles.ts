import { AlignmentType, LeaderType, TabStopType } from 'docx';

import { STO_RULES } from './sto-rules';

export const TOC_HEADING_STYLE_ID = 'TOCHeading';

export function createTocHeadingStyle(baseStyleId: string) {
	return {
		id: TOC_HEADING_STYLE_ID,
		name: 'TOC Heading',
		basedOn: baseStyleId,
		next: 'Normal',
		quickFormat: true,
		run: {
			font: STO_RULES.typography.fontFamily,
			size: STO_RULES.typography.fontSizeHalfPoints,
			color: STO_RULES.typography.fontColor,
			bold: true,
			allCaps: true,
		},
		paragraph: {
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0 },
			spacing: {
				before: 0,
				after: 240,
				line: STO_RULES.typography.captionLineSpacingDxa,
				lineRule: 'auto' as const,
			},
			outlineLevel: 9,
			pageBreakBefore: true,
		},
	};
}

function createTocStyle(level: number) {
	return {
		id: `TOC${level}`,
		name: `toc ${level}`,
		basedOn: level === 1 ? 'Normal' : 'TOC1',
		next: 'Normal',
		paragraph: {
			alignment: AlignmentType.LEFT,
			indent: {
				left: STO_RULES.typography.tocLevelIndentsDxa[level - 1] ?? 0,
				firstLine: 0,
			},
			tabStops: [
				{
					type: TabStopType.RIGHT,
					position: STO_RULES.typography.tocRightTabStopDxa,
					leader: LeaderType.DOT,
				},
			],
		},
	};
}

export const TOC_ENTRY_STYLES = STO_RULES.typography.tocLevelIndentsDxa.map(
	(_, index) => createTocStyle(index + 1),
);

/** Word selects built-in TOC styles by name when refreshing the field. */
export const WORD_TOC_ENTRY_STYLES = TOC_ENTRY_STYLES.map((style, index) => ({
	id: `WordTOC${index + 1}`,
	name: style.name,
	basedOn: style.id,
	next: 'Normal',
	paragraph: {
		spacing: {
			before: 0,
			after: 0,
			line: STO_RULES.typography.normalLineSpacingDxa,
			lineRule: 'auto' as const,
		},
	},
}));
