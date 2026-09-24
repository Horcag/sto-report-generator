import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function stripEquationLabel(formula: string): string {
	return formula.replace(/\(@eq:[a-zA-Z0-9_-]+\)/g, '').trim();
}

export function validateConsecutiveFormulaPunctuation(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const matches = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)];
	for (let index = 0; index < matches.length - 1; index++) {
		const current = matches[index];
		const next = matches[index + 1];
		const currentEnd = (current.index ?? 0) + current[0].length;
		const between = content.slice(currentEnd, next.index ?? currentEnd);
		if (between.trim().length > 0) {
			continue;
		}

		const formula = stripEquationLabel(current[1]);
		if (!/[,;]\s*$/.test(formula)) {
			issues.push(
				issue(
					'consecutive-formula-punctuation',
					'consecutive block formulas should be separated by a comma or semicolon when no text appears between them.',
					file,
					lineNumberAt(content, current.index ?? 0),
					'warning',
				),
			);
		}
	}
}

function validateWhereDefinitionPunctuation(
	file: string,
	content: string,
	formulaIndex: number,
	afterFormula: string,
	issues: SourcePreflightIssue[],
): void {
	const firstLineMatch = /^[\s\r\n]*(где[^\r\n]*)/i.exec(afterFormula);
	const firstLine = firstLineMatch?.[1]?.trimEnd();
	if (!firstLine) {
		return;
	}

	const continuationLines: string[] = [];
	const afterFirstLine = afterFormula
		.slice(firstLineMatch?.[0].length ?? 0)
		.replace(/^\r?\n/, '');
	for (const line of afterFirstLine.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!/^\$[^$]+\$\s+–/.test(trimmed)) {
			break;
		}
		continuationLines.push(trimmed);
	}

	const whereLines = [firstLine, ...continuationLines];
	if (
		continuationLines.length > 0 &&
		!whereLines.slice(0, -1).every(line => line.endsWith(';'))
	) {
		issues.push(
			issue(
				'formula-where-definition-separator',
				'multiline formula explanation after "где" should separate definitions with semicolons.',
				file,
				lineNumberAt(content, formulaIndex),
				'warning',
			),
		);
	}

	const whereBlock = whereLines.join('\n');
	if (!whereBlock.includes('.') && !whereBlock.endsWith('.')) {
		issues.push(
			issue(
				'formula-where-final-period',
				'formula explanation after "где" should end with a period.',
				file,
				lineNumberAt(content, formulaIndex),
				'warning',
			),
		);
	}
}

export function validateFormulaBeforeWhere(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
		const formulaEndIndex = (match.index ?? 0) + match[0].length;
		const afterFormula = content.slice(formulaEndIndex);
		if (!/^[\s\r\n]*где(?:\s|$)/i.test(afterFormula)) {
			continue;
		}

		const formula = stripEquationLabel(match[1]);
		if (formula.endsWith('.')) {
			issues.push(
				issue(
					'formula-period-before-where',
					'block formula before a lowercase "где" explanation should not end with a period.',
					file,
					lineNumberAt(content, match.index ?? 0),
					'warning',
				),
			);
		}
		validateWhereDefinitionPunctuation(
			file,
			content,
			match.index ?? 0,
			afterFormula,
			issues,
		);
	}
}
