import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { escapeRegExp, issue, lineNumberAt, stripMarkdownNoise } from './utils';

function isProbablyNonDecimalDotNumber(
	content: string,
	index: number,
): boolean {
	const lineStart = content.lastIndexOf('\n', index) + 1;
	const lineEnd = content.indexOf('\n', index);
	const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
	const beforeMatch = content.slice(lineStart, index);
	const previousContext = content.slice(
		Math.max(lineStart, index - 48),
		index,
	);
	return (
		/^\s*#+\s+\d+(?:\.\d+)+\b/.test(line) ||
		/^\s*\d+(?:\.\d+)+\s+/.test(line) ||
		/^\s*#+\s*$/.test(beforeMatch) ||
		/(?:раздел[а-я]*|подраздел[а-я]*|пункт[а-я]*|глав[а-я]*|рисунк[а-я]*|таблиц[а-я]*|формул[а-я]*|приложени[а-я]*|ГОСТ|СТО)\s+$/i.test(
			previousContext,
		) ||
		/https?:\/\/|www\.|\b\d+\.\d+\.\d+\b|\bv?\d+\.\d+\.\d+\b/i.test(line)
	);
}

function isSignedNumberInSymbolicExpression(
	content: string,
	dashIndex: number,
): boolean {
	const beforeDash = content.slice(Math.max(0, dashIndex - 24), dashIndex);
	return /(?:=|≈|≠|≤|≥|<|>)\s*$/.test(beforeDash);
}

function validateBareSymbol(
	file: string,
	content: string,
	symbol: string,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(
		new RegExp(escapeRegExp(symbol), 'g'),
	)) {
		const index = match.index ?? 0;
		const before = content.slice(Math.max(0, index - 8), index);
		const after = content.slice(
			index + symbol.length,
			index + symbol.length + 8,
		);
		const hasNumericContext =
			symbol === '%' ? /\d\s*$/.test(before) : /^\s*\d/.test(after);

		if (!hasNumericContext) {
			issues.push(
				issue(
					symbol === '%' ? 'bare-percent-sign' : 'bare-number-sign',
					`uses "${symbol}" without a numeric value. STO forbids ${symbol} without a number in regular text.`,
					file,
					lineNumberAt(content, index),
				),
			);
		}
	}
}

export function validateMicrotypography(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const text = stripMarkdownNoise(content);

	for (const marker of STO_RULES.validation.forbiddenLiteralMarkers) {
		if (content.includes(marker)) {
			issues.push(
				issue('forbidden-marker', `contains "${marker}" marker.`, file),
			);
		}
	}

	if (content.includes(STO_RULES.typography.forbiddenDash)) {
		issues.push(
			issue(
				'forbidden-dash',
				`contains em-dash (${STO_RULES.typography.forbiddenDash}). Use en-dash (${STO_RULES.typography.recommendedDash}) in STO reports.`,
				file,
			),
		);
	}

	if (content.includes('\t')) {
		issues.push(
			issue(
				'tab-character',
				'contains tab characters. Use spaces only.',
				file,
			),
		);
	}

	if (/\[0]/.test(content)) {
		issues.push(
			issue(
				'zero-citation',
				'contains citation [0]. Source numbering starts from [1].',
				file,
			),
		);
	}

	const manualCitationPattern = new RegExp(
		STO_RULES.validation.manualCitationNumberPattern,
		'g',
	);
	for (const match of content.matchAll(manualCitationPattern)) {
		issues.push(
			issue(
				'manual-source-citation',
				`contains manual source citation ${match[0]}. Use BibTeX cite keys like [@key] so numbering stays automatic.`,
				file,
				lineNumberAt(content, match.index ?? 0),
			),
		);
	}

	if (
		!STO_RULES.validation.allowedBoldMarkdownFiles.includes(file) &&
		/\*\*[^*]+\*\*/.test(content)
	) {
		issues.push(
			issue(
				'forbidden-bold-markdown',
				`contains bold markdown. Bold is allowed only in ${STO_RULES.validation.allowedBoldMarkdownFiles.join(', ')}.`,
				file,
			),
		);
	}

	validateBareSymbol(file, text, '%', issues);
	validateBareSymbol(file, text, '№', issues);

	for (const match of text.matchAll(/[<>]=?|[=≠≈≥≤]/g)) {
		const index = match.index ?? 0;
		const before = text.slice(Math.max(0, index - 4), index);
		const after = text.slice(
			index + match[0].length,
			index + match[0].length + 4,
		);
		if (!/\d/.test(before) && !/\d/.test(after)) {
			issues.push(
				issue(
					'bare-math-comparison-sign',
					`uses "${match[0]}" without a numeric value. Write the word form in regular text.`,
					file,
					lineNumberAt(text, index),
				),
			);
		}
	}

	for (const match of text.matchAll(/\d+\.\d+/g)) {
		const index = match.index ?? 0;
		if (!isProbablyNonDecimalDotNumber(text, index)) {
			issues.push(
				issue(
					'decimal-dot',
					`contains decimal dot in regular text: ${match[0]}. Use comma as decimal separator.`,
					file,
					lineNumberAt(text, index),
					'warning',
				),
			);
		}
	}

	for (const match of text.matchAll(/["]/g)) {
		issues.push(
			issue(
				'straight-quotes',
				'contains straight double quotes. Prefer Russian guillemets «...» in report text.',
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(/(^|[^\wа-яё])-+\d/gim)) {
		const dashOffset = match[0].lastIndexOf('-');
		const dashIndex = (match.index ?? 0) + dashOffset;
		if (isSignedNumberInSymbolicExpression(text, dashIndex)) {
			continue;
		}

		issues.push(
			issue(
				'hyphen-negative-number',
				'uses hyphen/minus before a negative number in text. STO recommends the word "минус".',
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}

	for (const match of text.matchAll(
		/от\s+\d+(?:[,.]\d+)?\s+([A-Za-zА-Яа-яЁё°%]+)\s+до\s+\d+(?:[,.]\d+)?\s+\1/gi,
	)) {
		issues.push(
			issue(
				'repeated-range-unit',
				`repeats a unit in a numeric range: "${match[0]}". Put the unit after the last value.`,
				file,
				lineNumberAt(text, match.index ?? 0),
				'warning',
			),
		);
	}
}
