import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt, stripEnvironmentBlocks } from './utils';

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
		.map((line, index) => ({ line, index }))
		.filter(({ line }) =>
			/^\s*(?:[-*+]|\d+\)\.?|\d+\.|[А-Яа-яЁё]\)\.?|[А-Яа-яЁё]\.)\s+/.test(
				line,
			),
		);

	for (let itemIndex = 0; itemIndex < itemLines.length; itemIndex++) {
		const { line, index } = itemLines[itemIndex];
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

		const itemText = trimmed.replace(
			/^(?:[-*+]|\d+[.)]|[А-Яа-яЁё][.)])\s+/,
			'',
		);
		const startsUppercase = /^[A-ZА-ЯЁ]/.test(itemText);
		const isLast = itemIndex === itemLines.length - 1;
		if (!isLast && startsUppercase && !/[.!?]$/.test(itemText)) {
			issues.push(
				issue(
					'list-item-uppercase-punctuation',
					'list item starts with an uppercase letter but does not end with a sentence punctuation mark.',
					file,
					lineNumber,
					'warning',
				),
			);
		}
		if (!isLast && !startsUppercase && !/[;,]$/.test(itemText)) {
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
