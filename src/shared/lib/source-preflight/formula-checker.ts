import { STO_RULES } from '@/shared/config';

import { validateFormulaLineBreaks } from './formula-line-break-checker';
import {
	maskFormulaSource,
	stripEquationLabel,
	validateConsecutiveFormulaPunctuation,
	validateFormulaBeforeWhere,
} from './formula-punctuation-checker';
import { SourcePreflightIssue } from './types';
import { escapeRegExp, issue, lineNumberAt } from './utils';

interface MathSpan {
	formula: string;
	index: number;
}

function hasForbiddenDivisionColon(formula: string): boolean {
	return /\d\s*:\s*\d|[a-zа-яё]\s+:\s+[a-zа-яё]/i.test(
		stripEquationLabel(formula),
	);
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
				new RegExp(String.raw`\\stoabbr\{\s*${escapedName}\s*\}`, 'g'),
				'',
			)
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

function findBareUprightAbbreviation(formula: string): string | undefined {
	// Braced text is already upright; commands are never bare identifiers.
	const withoutUpright = formula
		.replace(/\\(?:stoabbr|mathrm|operatorname|text)\{[^{}]*\}/g, '')
		.replace(/\\[A-Za-z]+/g, '');
	return STO_RULES.formulas.uprightAbbreviations.find(abbreviation =>
		new RegExp(
			String.raw`(^|[^A-Za-z])${escapeRegExp(abbreviation)}(?=$|[^A-Za-z])`,
		).test(withoutUpright),
	);
}

function forbiddenRawTokenMessage(rawToken: string): string {
	if (rawToken === '...' || rawToken === '…') {
		return `formula contains raw "${rawToken}". Use LaTeX ellipsis commands such as \\ldots, \\dots or \\cdots.`;
	}
	return `formula contains raw "${rawToken}". Use LaTeX multiplication commands such as \\times or \\cdot.`;
}

function validateNumberLetterMultiplicationDot(
	file: string,
	content: string,
	formula: string,
	index: number,
	issues: SourcePreflightIssue[],
): void {
	if (
		/\d\s*\\cdot\s*(?:[A-Za-zА-Яа-яЁё]|\\[A-Za-zА-Яа-яЁё]+)/u.test(formula)
	) {
		issues.push(
			issue(
				'formula-number-letter-cdot',
				'formula uses \\cdot between a number and a letter/function. STO notes do not put a multiplication dot between numeric and letter symbols.',
				file,
				lineNumberAt(content, index),
				'warning',
			),
		);
	}
}

function validateRedundantMultiplicationDot(
	file: string,
	content: string,
	formula: string,
	index: number,
	issues: SourcePreflightIssue[],
): void {
	if (/\\cdot\s*(?:\(|\\left\s*\(|\\(?:frac|dfrac|tfrac)\b)/u.test(formula)) {
		issues.push(
			issue(
				'formula-redundant-cdot',
				'formula uses \\cdot before a parenthesized expression or fraction. Check whether the multiplication sign should be omitted.',
				file,
				lineNumberAt(content, index),
				'warning',
			),
		);
	}
}

export function validateSourceFormulas(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	content = maskFormulaSource(content);
	const blockFormulas = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)];
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
	for (const span of collectMathSpans(content)) {
		const bareAbbreviation = findBareUprightAbbreviation(span.formula);
		if (bareAbbreviation) {
			issues.push(
				issue(
					'formula-bare-upright-abbreviation',
					`formula contains italic abbreviation "${bareAbbreviation}". Use \\stoabbr{${bareAbbreviation}} for upright text.`,
					file,
					lineNumberAt(content, span.index),
					'warning',
				),
			);
		}
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
						forbiddenRawTokenMessage(rawToken),
						file,
						lineNumberAt(content, span.index),
						'warning',
					),
				);
			}
		}
		for (const sign of STO_RULES.formulas
			.forbiddenSourceMultiplicationSigns) {
			if (span.formula.includes(sign)) {
				issues.push(
					issue(
						'formula-forbidden-multiplication-sign',
						`formula contains "${sign}" as multiplication sign. Use LaTeX commands that render STO-compatible multiplication.`,
						file,
						lineNumberAt(content, span.index),
					),
				);
			}
		}
		if (/\d+\.\d+/.test(span.formula)) {
			issues.push(
				issue(
					'formula-decimal-dot',
					'formula contains decimal dot. Use comma as decimal separator.',
					file,
					lineNumberAt(content, span.index),
				),
			);
		}
		validateFormulaLineBreaks(
			file,
			content,
			span.formula,
			span.index,
			issues,
		);
		validateNumberLetterMultiplicationDot(
			file,
			content,
			span.formula,
			span.index,
			issues,
		);
		validateRedundantMultiplicationDot(
			file,
			content,
			span.formula,
			span.index,
			issues,
		);
	}
	for (const match of blockFormulas) {
		const formula = match[1];
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

	for (const block of blockFormulas) {
		const before = content.slice(0, block.index).split('\n');
		const after = content.slice(block.index + block[0].length).split('\n');
		if (
			[before.at(-1), before.at(-2), after[0], after[1]].some(line =>
				line?.trim(),
			)
		) {
			issues.push(
				issue(
					'formula-missing-surrounding-blank-line',
					'block formulas should be separated from surrounding text by blank lines.',
					file,
					lineNumberAt(content, block.index),
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
