import {
	ImageRun,
	Paragraph,
	ParagraphChild,
	Table,
	TableOfContents,
	TextRun,
} from 'docx';
import { Token } from 'marked';

import { AppendixHeading } from '@/shared/config';
import { FigurePlan, FigureSettings } from '@/shared/lib/figures';

export type DocxElement = Paragraph | Table | TableOfContents;

/**
 * Result of math conversion from @hungknguyen/docx-math-converter.
 * The library returns an object that docx Paragraph can accept as a child.
 */
export type MathConversionResult = ParagraphChild;

export type InlineDocxElement = TextRun | ImageRun | MathConversionResult;

export interface BibItem {
	citationKey: string;
	entryType: string;
	entryTags: Record<string, string | undefined>;
}

export interface ParserContext {
	itemMap: Map<string, string>;
	citations: string[];
	bibDb: BibItem[];
	listInstanceCounter: number;
	sourceDir?: string;
	figureSettings?: FigureSettings;
	figurePlans?: FigurePlan[];
	figureIds?: WeakMap<object, string>;
	figureCounter?: number;
}

export interface StoFlagToken {
	type: 'stoFlag';
	raw: string;
	flagType:
		'structural_heading' | 'appendix' | 'environment' | 'referat_field';
	text?: string;
	referatField?: 'characteristics' | 'application';
	appendix?: AppendixHeading;
	envName?: string;
	content?: string;
	tokens: Token[];
}

export interface ProcessTokensContext {
	keepFormulaWithExplanation?: boolean;
	structuralHeading?: string;
	isBib?: boolean;
	isStoList?: boolean;
	listType?: 'bullet' | 'ordered';
	instance?: number;
}
