import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

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
	}

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
