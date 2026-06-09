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
		sourcesStructuralHeading: string;
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
		tocRightTabStopDxa: number;
		tocLevelIndentsDxa: number[];
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
	titlePage: {
		organizationLines: string[];
	};
	headings: {
		structuralNoTocUppercase: string[];
		requiredStructuralUppercase: string[];
	};
	referat: {
		fileName: string;
		statisticPlaceholders: string[];
		keywordCount: {
			min: number;
			max: number;
		};
		semanticMarkers: string[];
		maxTextLengthChars: number;
	};
	lists: {
		forbiddenRussianLetterMarkers: string[];
		russianLetterSequence: string[];
		introTrailingPrepositions: string[];
		markerPolicies: {
			parenthesized: {
				nonFinalLowercaseEndings: string[];
				finalEndings: string[];
			};
			dotted: {
				requireUppercaseStart: boolean;
				itemEndings: string[];
			};
		};
	};
	tables: {
		discouragedOrdinalHeaders: string[];
	};
	formulas: {
		forbiddenSourceMultiplicationSigns: string[];
		uprightFunctions: string[];
		forbiddenRawTokens: string[];
		lineBreakOperators: {
			repeatRequired: string[];
			forbiddenBeforeBreak: string[];
		};
	};
	bibliography: {
		urlProtocols: string[];
		urldatePattern: string;
		latinLangidValues: string[];
		articlePreprintJournalPatterns: string[];
		doiUrlPrefixes: string[];
		requiredFieldsByType: Record<string, string[][]>;
	};
	documentStructure: {
		requiredOrder: string[];
	};
	validation: {
		allowedBoldMarkdownFiles: string[];
		forbiddenLiteralMarkers: string[];
		figureCaptionPrefix: string;
		tableCaptionPrefix: string;
		manualCitationNumberPattern: string;
	};
}

export const STO_RULES = stoRulesJson as StoRules;
export const SUPPORTED_STO_ENVIRONMENTS = new Set(
	STO_RULES.markdown.supportedEnvironments,
);
export const STO_LIST_ENVIRONMENTS = new Set(
	STO_RULES.markdown.listEnvironments,
);
