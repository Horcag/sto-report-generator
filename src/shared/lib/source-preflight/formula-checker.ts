import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { escapeRegExp, issue, lineNumberAt } from './utils';

interface MathSpan {
	formula: string;
	index: number;
}

function stripEquationLabel(formula: string): string {
	return formula.replace(/\(@eq:[a-zA-Z0-9_-]+\)/g, '').trim();
}

function hasForbiddenDivisionColon(formula: string): boolean {
	const withoutLabels = stripEquationLabel(formula);
	return /\d\s*:\s*\d|[a-zа-яё]\s+:\s+[a-zа-яё]/i.test(withoutLabels);
}

function collectMathSpans(content: string): MathSpan[] {
	return [
		...[...content.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(match => ({
			formula: match[1],
			index: match.index ?? 0,
		})),
		...[...content.matchAll(/(?<!\$)\$([^$\n]+)\$(?!\$)/g)].map(match => ({
			formula: match[1],
			index: match.index ?? 0,
		})),
	];
}

function stripAcceptedUprightFunctionNotation(formula: string): string {
	let result = formula;
	for (const functionName of STO_RULES.formulas.uprightFunctions) {
		const escapedName = escapeRegExp(functionName);
		result = result
			.replace(new RegExp(String.raw`\\${escapedName}\b`, 'g'), '')
			.replace(
				new RegExp(
					String.raw`\\(?:operatorname|mathrm|text)\{\s*${escapedName}\s*\}`,
					'g',
				),
				'',
			);
	}
	return result;
}

function findBareUprightFunction(formula: string): string | undefined {
	const names = [...STO_RULES.formulas.uprightFunctions].sort(
		(left, right) => right.length - left.length,
	);
	const withoutAcceptedNotation =
		stripAcceptedUprightFunctionNotation(formula);
	const match = new RegExp(
		String.raw`(?:^|[^\\A-Za-z])(${names.map(escapeRegExp).join('|')})(?![A-Za-z])`,
	).exec(withoutAcceptedNotation);
	return match?.[1];
}

function lastConfiguredOperator(
	value: string,
	operators: readonly string[],
): string | undefined {
	const trimmed = value.trimEnd();
	return [...operators]
		.sort((left, right) => right.length - left.length)
		.find(operator => trimmed.endsWith(operator));
}

function validateFormulaLineBreaks(
	file: string,
	content: string,
	formula: string,
	index: number,
	issues: SourcePreflightIssue[],
): void {
	const parts = formula.split(/\\\\/);
	if (parts.length < 2) {
		return;
	}

	for (let partIndex = 0; partIndex < parts.length - 1; partIndex++) {
		const beforeBreak = parts[partIndex];
		const afterBreak = parts[partIndex + 1].trimStart();
		const forbiddenOperator = lastConfiguredOperator(
			beforeBreak,
			STO_RULES.formulas.lineBreakOperators.forbiddenBeforeBreak,
		);
		if (forbiddenOperator) {
			issues.push(
				issue(
					'formula-line-break-after-division',
					`formula line break appears after "${forbiddenOperator}". STO notes do not allow formula breaks on division signs.`,
					file,
					lineNumberAt(content, index),
					'warning',
				),
			);
			continue;
		}

		const repeatedOperator = lastConfiguredOperator(
			beforeBreak,
			STO_RULES.formulas.lineBreakOperators.repeatRequired,
		);
		if (repeatedOperator && !afterBreak.startsWith(repeatedOperator)) {
			issues.push(
				issue(
					'formula-line-break-operator-not-repeated',
					`formula line break after "${repeatedOperator}" should repeat the operator at the start of the next line.`,
					file,
					lineNumberAt(content, index),
					'warning',
				),
			);
		}
	}
}

function validateConsecutiveFormulaPunctuation(
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

function validateFormulaBeforeWhere(
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
	}
}

export function validateSourceFormulas(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const rawEquationNumberMatches = [
		...content.matchAll(/\$\$[\s\S]*?\(\d+\)\s*\$\$/g),
	];
	for (const match of rawEquationNumberMatches) {
		issues.push(
			issue(
				'hard-coded-formula-number',
				'contains a hard-coded formula number. Use automatic labels like (@eq:formula_id).',
				file,
				lineNumberAt(content, match.index ?? 0),
			),
		);
	}

	for (const match of content.matchAll(/\(@eq:([a-zA-Z0-9_-]+)\)/g)) {
		const before = content.lastIndexOf('$$', match.index ?? 0);
		const after = content.indexOf(
			'$$',
			(match.index ?? 0) + match[0].length,
		);
		if (before === -1 || after === -1) {
			issues.push(
				issue(
					'formula-label-outside-block',
					`formula label @eq:${match[1]} is outside a block formula.`,
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}

	for (const span of collectMathSpans(content)) {
		const bareFunction = findBareUprightFunction(span.formula);
		if (bareFunction) {
			issues.push(
				issue(
					'formula-bare-upright-function',
					`formula contains bare "${bareFunction}". Use LaTeX upright function commands such as \\${bareFunction}.`,
					file,
					lineNumberAt(content, span.index),
					'warning',
				),
			);
		}

		for (const rawToken of STO_RULES.formulas.forbiddenRawTokens) {
			if (span.formula.includes(rawToken)) {
				issues.push(
					issue(
						'formula-forbidden-raw-token',
						`formula contains raw "${rawToken}". Use LaTeX ellipsis commands such as \\ldots, \\dots or \\cdots.`,
						file,
						lineNumberAt(content, span.index),
						'warning',
					),
				);
			}
		}
		validateFormulaLineBreaks(
			file,
			content,
			span.formula,
			span.index,
			issues,
		);
	}

	for (const match of content.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
		const formula = match[1];
		for (const sign of STO_RULES.formulas
			.forbiddenSourceMultiplicationSigns) {
			if (formula.includes(sign)) {
				issues.push(
					issue(
						'formula-forbidden-multiplication-sign',
						`formula contains "${sign}" as multiplication sign. Use LaTeX commands that render STO-compatible multiplication.`,
						file,
						lineNumberAt(content, match.index ?? 0),
					),
				);
			}
		}
		if (/\d+\.\d+/.test(formula)) {
			issues.push(
				issue(
					'formula-decimal-dot',
					'formula contains decimal dot. Use comma as decimal separator.',
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
		if (hasForbiddenDivisionColon(formula)) {
			issues.push(
				issue(
					'formula-forbidden-division-colon',
					'formula contains ":" as division sign. STO requires fraction notation or a proper division operator, not a colon.',
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}
	validateConsecutiveFormulaPunctuation(file, content, issues);
	validateFormulaBeforeWhere(file, content, issues);

	const lines = content.split('\n');
	for (let index = 0; index < lines.length; index++) {
		if (!lines[index].includes('$$')) {
			continue;
		}
		const previous = lines[index - 1]?.trim() ?? '';
		const next = lines[index + 1]?.trim() ?? '';
		if (previous.length > 0 || next.length > 0) {
			issues.push(
				issue(
					'formula-missing-surrounding-blank-line',
					'block formulas should be separated from surrounding text by blank lines.',
					file,
					index + 1,
					'warning',
				),
			);
		}
	}

	const metricMatches = content.match(
		/(?:ROC-AUC|PR-AUC|F1-score|CV)(?:\s*[:=]\s*)(\d+\.\d+)/gi,
	);
	if (metricMatches) {
		for (const match of metricMatches) {
			issues.push(
				issue(
					'decimal-dot-in-metric',
					`contains decimal dot in metric: ${match}. Use comma instead.`,
					file,
					undefined,
					'warning',
				),
			);
		}
	}
}
