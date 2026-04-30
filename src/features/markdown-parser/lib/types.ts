import { ImageRun, Paragraph, Table, TableOfContents, TextRun } from 'docx';
import { Token } from 'marked';

export type DocxElement = Paragraph | Table | TableOfContents;

/**
 * Result of math conversion from @hungknguyen/docx-math-converter.
 * The library returns an object that docx Paragraph can accept as a child.
 */
export type MathConversionResult = Record<string, unknown>;

export type InlineDocxElement = TextRun | ImageRun | MathConversionResult;

export interface BibItem {
	citationKey: string;
	entryType: string;
	entryTags: Record<string, string | undefined>;
}

export interface ParserContext {
	itemMap: Map<string, number>;
	citations: string[];
	bibDb: BibItem[];
	listInstanceCounter: number;
}

export interface StoFlagToken extends Token {
	type: 'stoFlag';
	flagType: 'structural_heading' | 'environment';
	text: string;
	envName?: string;
	tokens: Token[];
}

export interface ProcessTokensContext {
	isBib?: boolean;
	isStoList?: boolean;
	listType?: 'bullet' | 'ordered';
	instance?: number;
}
