import { STO_RULES } from '@/shared/config';
import { splitDisplayMathLines } from '@/shared/lib/math/display-lines';

import { stripEquationLabel } from './formula-punctuation-checker';
import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

function lastConfiguredOperator(
	value: string,
	operators: readonly string[],
): string | undefined {
	const trimmed = value.trimEnd();
	return [...operators]
		.sort((left, right) => right.length - left.length)
		.find(operator => trimmed.endsWith(operator));
}

export function validateFormulaLineBreaks(
	file: string,
	content: string,
	formula: string,
	index: number,
	issues: SourcePreflightIssue[],
): void {
	let parts: string[];
	try {
		parts = splitDisplayMathLines(stripEquationLabel(formula));
	} catch (error) {
		issues.push(
			issue(
				error instanceof Error &&
					error.message.includes('empty continuation')
					? 'formula-empty-continuation'
					: 'formula-unsupported-continuation',
				error instanceof Error
					? error.message
					: 'Invalid display continuation.',
				file,
				lineNumberAt(content, index),
			),
		);
		return;
	}
	const relations: Record<string, string> = {
		le: '≤',
		leq: '≤',
		ge: '≥',
		geq: '≥',
		approx: '≈',
		lt: '<',
		gt: '>',
	};
	parts = parts.map(part =>
		part.replace(
			/\\(leq?|geq?|approx|lt|gt)\b/g,
			(_match, name: string) => relations[name],
		),
	);
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
