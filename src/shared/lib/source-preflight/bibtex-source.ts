import fs from 'node:fs';
import * as bibtexParse from '@orcid/bibtex-parse-js';

import { lineNumberAt } from './utils';

export interface BibEntrySource {
	entryType: string;
	key: string;
	tags: Record<string, string | undefined>;
	line: number;
}

export function readBibEntrySources(bibPath: string): BibEntrySource[] {
	const content = fs.readFileSync(bibPath, 'utf8');
	const linesByKey = new Map<string, number[]>();
	for (const match of content.matchAll(/@([\w-]+)\s*\{\s*([^,\s{}]+)\s*,/g)) {
		const lines = linesByKey.get(match[2]) ?? [];
		lines.push(lineNumberAt(content, match.index ?? 0));
		linesByKey.set(match[2], lines);
	}
	return bibtexParse
		.toJSON(content)
		.filter(entry => entry.entryTags && entry.citationKey)
		.map(entry => ({
			entryType: entry.entryType.toLowerCase(),
			key: entry.citationKey,
			tags: Object.fromEntries(
				Object.entries(entry.entryTags).map(([key, value]) => [
					key.toLowerCase(),
					value,
				]),
			),
			line: linesByKey.get(entry.citationKey)?.shift() ?? 1,
		}));
}

export function hasBibTag(entry: BibEntrySource, tagName: string): boolean {
	return Boolean(entry.tags[tagName]?.trim());
}

export function readBibTagValue(
	entry: BibEntrySource,
	tagName: string,
): string | undefined {
	return entry.tags[tagName]?.trim();
}

export function hasAnyBibTag(
	entry: BibEntrySource,
	tagNames: readonly string[],
): boolean {
	return tagNames.some(tagName => hasBibTag(entry, tagName));
}

export function getNormalizedTagValue(
	entry: BibEntrySource,
	tagName: string,
): string | undefined {
	return readBibTagValue(entry, tagName)?.replace(/[{}]/g, '').trim();
}
