import stoRulesJson from './sto-rules.json';

export interface StoRules {
	metadata: {
		standard: string;
		references: string[];
		purpose: string;
	};
	markdown: {
		structuralHeadingCommand: string;
		supportedEnvironments: string[];
		listEnvironments: string[];
		bibliographyEnvironment: string;
	};
	typography: {
		fontFamily: string;
		fontSizePoints: number;
		fontSizeHalfPoints: number;
		fontColor: string;
		normalLineSpacingDxa: number;
		captionLineSpacingDxa: number;
		firstLineIndentDxa: number;
		nestedListIndentStepDxa: number;
		captionFirstLineIndentDxa: number;
		forbiddenDash: string;
		recommendedDash: string;
		listMarker: string;
	};
	page: {
		marginsDxa: {
			top: number;
			bottom: number;
			left: number;
			right: number;
		};
		imageMaxWidthEmu: number;
	};
	headings: {
		structuralNoTocUppercase: string[];
		requiredStructuralUppercase: string[];
	};
	validation: {
		allowedBoldMarkdownFiles: string[];
		forbiddenLiteralMarkers: string[];
		figureCaptionPrefix: string;
		tableCaptionPrefix: string;
	};
}

export const STO_RULES = stoRulesJson as StoRules;
export const SUPPORTED_STO_ENVIRONMENTS = new Set(
	STO_RULES.markdown.supportedEnvironments,
);
export const STO_LIST_ENVIRONMENTS = new Set(
	STO_RULES.markdown.listEnvironments,
);
