import { STO_RULES } from '@/shared/config';

import {
	ListItemLine,
	ListMarkerStyle,
	parseListItemLine,
} from './list-marker-parser';
import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt, stripEnvironmentBlocks } from './utils';

function endsWithAny(value: string, endings: readonly string[]): boolean {
	return endings.some(ending => value.endsWith(ending));
}

function shouldSkipListIntroLine(trimmed: string): boolean {
	return (
		trimmed.length === 0 ||
		trimmed.startsWith('#') ||
		/^\\sto_structural_heading\{/.test(trimmed)
	);
}

function validateListIntro(
	file: string,
	content: string,
	blockStartIndex: number,
	issues: SourcePreflightIssue[],
): void {
	const prefixLines = content.slice(0, blockStartIndex).split('\n');
	for (let index = prefixLines.length - 1; index >= 0; index--) {
		const trimmed = prefixLines[index].trim();
		if (trimmed.length === 0) {
			continue;
		}
		if (shouldSkipListIntroLine(trimmed)) {
			return;
		}

		const lineNumber = index + 1;
		if (!/[.:]$/.test(trimmed)) {
			issues.push(
				issue(
					'list-intro-punctuation',
					'list introduction should usually end with a colon or a period.',
					file,
					lineNumber,
					'warning',
				),
			);
		}

		const lastWord = trimmed
			.replace(/[.:;!?]+$/u, '')
			.split(/\s+/u)
			.at(-1)
			?.toLowerCase();
		if (
			lastWord &&
			STO_RULES.lists.introTrailingPrepositions.includes(lastWord)
		) {
			issues.push(
				issue(
					'list-intro-trailing-preposition',
					'list introduction should not leave a trailing preposition before the list.',
					file,
					lineNumber,
					'warning',
				),
			);
		}
		return;
	}
}

function validateStoListBlock(
	file: string,
	content: string,
	envName: string,
	blockContent: string,
	blockStartIndex: number,
	issues: SourcePreflightIssue[],
): void {
	const forbiddenLetters = new Set(
		STO_RULES.lists.forbiddenRussianLetterMarkers.map(letter =>
			letter.toLowerCase(),
		),
	);
	const lines = blockContent.split('\n');
	const itemLines = lines
		.map((line, index) => parseListItemLine(line, index))
		.filter((item): item is ListItemLine => item !== undefined);
	validateListMarkerConsistency(
		file,
		content,
		lines,
		blockStartIndex,
		itemLines,
		issues,
	);

	for (let itemIndex = 0; itemIndex < itemLines.length; itemIndex++) {
		const { line, index, itemText, marker, markerKind } =
			itemLines[itemIndex];
		const absoluteIndex =
			blockStartIndex +
			lines.slice(0, index).join('\n').length +
			(index > 0 ? 1 : 0);
		const lineNumber = lineNumberAt(content, absoluteIndex);
		const trimmed = line.trim();

		const extraDot = /^(\d+|[А-Яа-яЁё])\)\.\s+/.exec(trimmed);
		if (extraDot) {
			issues.push(
				issue(
					'list-marker-extra-dot',
					`list marker "${extraDot[0].trim()}" must not contain a dot after the closing parenthesis.`,
					file,
					lineNumber,
				),
			);
		}

		const letterMarker = /^([А-Яа-яЁё])[.)]\s+/.exec(trimmed);
		if (
			letterMarker &&
			forbiddenLetters.has(letterMarker[1].toLowerCase())
		) {
			issues.push(
				issue(
					'forbidden-list-letter-marker',
					`letter marker "${letterMarker[1]})" is forbidden by STO list rules.`,
					file,
					lineNumber,
				),
			);
		}

		const startsUppercase = /^[A-ZА-ЯЁ]/.test(itemText);
		const startsWithSymbolicDefinition = /^\$[^$]+\$\s+–/.test(itemText);
		const isLast = !itemLines
			.slice(itemIndex + 1)
			.some(
				next => next.indentSpaces === itemLines[itemIndex].indentSpaces,
			);
		const parenthesizedPolicy =
			STO_RULES.lists.markerPolicies.parenthesized;
		const dottedPolicy = STO_RULES.lists.markerPolicies.dotted;

		if (markerKind === 'dotted') {
			if (
				dottedPolicy.requireUppercaseStart &&
				itemText.length > 0 &&
				!startsUppercase
			) {
				issues.push(
					issue(
						'list-dotted-item-case',
						`list item with marker "${marker}" should start with an uppercase letter.`,
						file,
						lineNumber,
						'warning',
					),
				);
			}
			if (!endsWithAny(itemText, dottedPolicy.itemEndings)) {
				issues.push(
					issue(
						'list-dotted-item-punctuation',
						`list item with marker "${marker}" should end with a period.`,
						file,
						lineNumber,
						'warning',
					),
				);
			}
			continue;
		}

		if (!isLast && !/[;,.!?]$/.test(itemText)) {
			issues.push(
				issue(
					'list-item-missing-punctuation',
					'list item should end with a punctuation mark.',
					file,
					lineNumber,
					'warning',
				),
			);
		}
		if (
			!isLast &&
			!startsUppercase &&
			!startsWithSymbolicDefinition &&
			!endsWithAny(itemText, parenthesizedPolicy.nonFinalLowercaseEndings)
		) {
			issues.push(
				issue(
					'list-item-lowercase-punctuation',
					'list item starts with a lowercase letter and should usually end with comma or semicolon.',
					file,
					lineNumber,
					'warning',
				),
			);
		}
		if (
			isLast &&
			!startsWithSymbolicDefinition &&
			!endsWithAny(itemText, parenthesizedPolicy.finalEndings)
		) {
			issues.push(
				issue(
					'list-final-item-punctuation',
					'last list item should usually end with a period.',
					file,
					lineNumber,
					'warning',
				),
			);
		}

		if (envName === STO_RULES.markdown.bibliographyEnvironment) {
			issues.push(
				issue(
					'list-inside-bibliography-environment',
					'sto_bibliography must stay empty; cited BibTeX entries are inserted automatically.',
					file,
					lineNumber,
				),
			);
		}
	}
}

function lineNumberForListItem(
	content: string,
	lines: readonly string[],
	blockStartIndex: number,
	item: ListItemLine,
): number {
	const absoluteIndex =
		blockStartIndex +
		lines.slice(0, item.index).join('\n').length +
		(item.index > 0 ? 1 : 0);
	return lineNumberAt(content, absoluteIndex);
}

function validateListMarkerConsistency(
	file: string,
	content: string,
	lines: readonly string[],
	blockStartIndex: number,
	itemLines: readonly ListItemLine[],
	issues: SourcePreflightIssue[],
): void {
	const previousStyleByIndent = new Map<number, ListMarkerStyle>();
	const previousOrdinalByLevel = new Map<string, number>();
	const reportedMixedIndents = new Set<number>();

	for (const item of itemLines) {
		const previousStyle = previousStyleByIndent.get(item.indentSpaces);
		if (
			previousStyle &&
			previousStyle !== item.markerStyle &&
			!reportedMixedIndents.has(item.indentSpaces)
		) {
			issues.push(
				issue(
					'list-mixed-marker-style',
					'list items at the same indentation level should use one marker style.',
					file,
					lineNumberForListItem(
						content,
						lines,
						blockStartIndex,
						item,
					),
					'warning',
				),
			);
			reportedMixedIndents.add(item.indentSpaces);
		}
		previousStyleByIndent.set(item.indentSpaces, item.markerStyle);

		if (item.markerOrdinal === undefined || item.markerStyle === 'bullet') {
			continue;
		}

		const sequenceKey = `${item.indentSpaces}:${item.markerStyle}`;
		const previousOrdinal = previousOrdinalByLevel.get(sequenceKey);
		const expectedOrdinal =
			previousOrdinal === undefined ? 1 : previousOrdinal + 1;
		if (item.markerOrdinal !== expectedOrdinal) {
			issues.push(
				issue(
					'list-marker-sequence-gap',
					`list marker "${item.marker}" should continue the sequence without gaps.`,
					file,
					lineNumberForListItem(
						content,
						lines,
						blockStartIndex,
						item,
					),
					'warning',
				),
			);
		}
		previousOrdinalByLevel.set(sequenceKey, item.markerOrdinal);
	}
}

export function validateLists(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const contentWithoutStoLists = stripEnvironmentBlocks(
		content,
		STO_RULES.markdown.listEnvironments,
	);
	const rawListMatches = [
		...contentWithoutStoLists.matchAll(/^(?:\s*[-*+]\s+|\s*\d+\.\s+)/gm),
	];
	for (const match of rawListMatches) {
		issues.push(
			issue(
				'raw-markdown-list',
				'contains a raw Markdown list. Use \\begin{sto_list}...\\end{sto_list} or \\begin{sto_enum}...\\end{sto_enum}.',
				file,
				lineNumberAt(contentWithoutStoLists, match.index ?? 0),
			),
		);
	}

	for (const match of content.matchAll(
		/\\begin\{([^}]+)\}([\s\S]*?)\\end\{\1\}/g,
	)) {
		if (
			STO_RULES.markdown.listEnvironments.includes(match[1]) ||
			match[1] === STO_RULES.markdown.bibliographyEnvironment
		) {
			if (STO_RULES.markdown.listEnvironments.includes(match[1])) {
				validateListIntro(file, content, match.index ?? 0, issues);
			}
			validateStoListBlock(
				file,
				content,
				match[1],
				match[2],
				(match.index ?? 0) + match[0].indexOf(match[2]),
				issues,
			);
		}
	}
}
