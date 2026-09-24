import { STO_RULES } from '@/shared/config';

export type ListMarkerKind = 'bullet' | 'dotted' | 'parenthesized';
export type ListMarkerStyle =
	| 'bullet'
	| 'decimal-dotted'
	| 'decimal-parenthesized'
	| 'roman-dotted'
	| 'russian-dotted'
	| 'russian-parenthesized';

export interface ListItemLine {
	indentSpaces: number;
	index: number;
	itemText: string;
	line: string;
	marker: string;
	markerKind: ListMarkerKind;
	markerOrdinal?: number;
	markerStyle: ListMarkerStyle;
}

const ROMAN_VALUES: Record<string, number> = {
	C: 100,
	D: 500,
	I: 1,
	L: 50,
	M: 1000,
	V: 5,
	X: 10,
};

function parseRomanNumeral(value: string): number | undefined {
	const upper = value.toUpperCase();
	if (!/^[IVXLCDM]+$/.test(upper)) {
		return undefined;
	}

	let total = 0;
	for (let index = 0; index < upper.length; index++) {
		const current = ROMAN_VALUES[upper[index]];
		const next = ROMAN_VALUES[upper[index + 1]] ?? 0;
		total += current < next ? -current : current;
	}
	return total > 0 ? total : undefined;
}

function markerStyle(marker: string): ListMarkerStyle {
	if (/^[-*+]$/.test(marker)) {
		return 'bullet';
	}
	if (/^\d+\)$/.test(marker) || /^\d+\)\.$/.test(marker)) {
		return 'decimal-parenthesized';
	}
	if (/^\d+\.$/.test(marker)) {
		return 'decimal-dotted';
	}
	if (/^[IVXLCDM]+\.$/.test(marker)) {
		return 'roman-dotted';
	}
	if (/^[А-Яа-яЁё]\)$/.test(marker) || /^[А-Яа-яЁё]\)\.$/.test(marker)) {
		return 'russian-parenthesized';
	}
	return 'russian-dotted';
}

function markerOrdinal(
	marker: string,
	style: ListMarkerStyle,
): number | undefined {
	if (style === 'decimal-dotted' || style === 'decimal-parenthesized') {
		return Number.parseInt(marker, 10);
	}
	if (style === 'roman-dotted') {
		return parseRomanNumeral(marker.replace('.', ''));
	}
	if (style === 'russian-dotted' || style === 'russian-parenthesized') {
		const letter = marker[0].toLowerCase();
		const index = STO_RULES.lists.russianLetterSequence.indexOf(letter);
		return index === -1 ? undefined : index + 1;
	}
	return undefined;
}

export function parseListItemLine(
	line: string,
	index: number,
): ListItemLine | undefined {
	const markerMatch =
		/^\s*(?<marker>[-*+]|\d+\)\.?|\d+\.|[А-Яа-яЁё]\)\.?|[А-Яа-яЁё]\.|[IVXLCDM]+\.)\s+/u.exec(
			line,
		);
	const marker = markerMatch?.groups?.marker;
	if (!marker) {
		return undefined;
	}

	const style = markerStyle(marker);
	let markerKind: ListMarkerKind = 'bullet';
	if (marker.includes(')')) {
		markerKind = 'parenthesized';
	} else if (marker.endsWith('.')) {
		markerKind = 'dotted';
	}

	return {
		indentSpaces: /^\s*/.exec(line)?.[0].length ?? 0,
		index,
		itemText: line.trim().slice(marker.length).trim(),
		line,
		marker,
		markerKind,
		markerOrdinal: markerOrdinal(marker, style),
		markerStyle: style,
	};
}
