import {
	hasExplanationFinalPeriod,
	inspectFormulaExplanation,
	startsSymbolDefinition,
} from '../math/formula-punctuation';
import { maskSourceCodeFences } from './text-context';
import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function stripEquationLabel(formula: string): string {
	return formula.replace(/\s*\(@eq:[a-zA-Z0-9_-]+\)[,;.]?\s*$/u, '').trim();
}

/** Keep offsets; literal code is a barrier, while invisible comments are whitespace. */
export function maskFormulaSource(content: string): string {
	const fenced = maskSourceCodeFences(content);
	return fenced
		.split('')
		.map((char, index) => (char !== content[index] ? '\uFFFC' : char))
		.join('')
		.replace(/<!--[\s\S]*?(?:-->|$)/g, span =>
			span.replace(/[^\r\n]/g, ' '),
		)
		.replace(
			/(`+)[\s\S]*?\1(?!`)|\$\$[\s\S]*?\$\$|^(?: {4}|\t)[^\r\n]*|<(pre|code)\b[^>]*>[\s\S]*?<\/\2>/gim,
			span =>
				span.startsWith('$$')
					? span
					: span.replace(/[^\r\n]/g, '\uFFFC'),
		);
}

function explanationText(content: string): string {
	return content.replace(/\$([^$\r\n]+)\$/g, '⟦$1⟧');
}

export function validateConsecutiveFormulaPunctuation(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	content = maskFormulaSource(content);
	const matches = [...content.matchAll(/\$\$([\s\S]*?)\$\$/g)];
	for (let index = 0; index < matches.length - 1; index++) {
		const current = matches[index];
		const next = matches[index + 1];
		const between = content.slice(
			current.index + current[0].length,
			next.index,
		);
		if (between.trim()) continue;
		if (!/[,;]\s*$/.test(stripEquationLabel(current[1]))) {
			issues.push(
				issue(
					'consecutive-formula-punctuation',
					'Consecutive block formulas without intervening text require a comma or semicolon. Example: $$ a=b; (@eq:first) $$ followed by $$ c=d $$ (STO 6.3.2).',
					file,
					lineNumberAt(content, current.index),
				),
			);
		}
	}
}

export function validateFormulaBeforeWhere(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	content = maskFormulaSource(content);
	for (const match of content.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
		const after = content.slice(match.index + match[0].length);
		if (!/^\s*где(?=\s|:|$)/iu.test(after)) continue;
		const lines = after.trimStart().split(/\r?\n/);
		const explanation: string[] = [];
		let blank = false;
		for (const line of lines) {
			if (!line.trim()) {
				blank = true;
				continue;
			}
			if (
				explanation.length &&
				blank &&
				!startsSymbolDefinition(explanationText(line))
			)
				break;
			if (
				/\$\$|^\s*(?:#|\\sto_|\\begin\{|\|)/u.test(line) ||
				/^[\s\uFFFC]+$/u.test(line)
			)
				break;
			explanation.push(line);
			blank = false;
		}
		const parsed = inspectFormulaExplanation(
			explanationText(explanation.join('\n')),
		);
		if (!parsed) continue;
		const formulaLine = lineNumberAt(content, match.index);
		const whereLine = lineNumberAt(
			content,
			match.index + match[0].length + after.search(/\S/u),
		);
		const formula = stripEquationLabel(match[1]);
		if (!formula.endsWith(',')) {
			issues.push(
				issue(
					formula.endsWith('.')
						? 'formula-period-before-where'
						: 'formula-comma-before-where',
					`${formula.endsWith('.') ? 'A period cannot replace the required comma. ' : ''}Block formula immediately before a structured "где" explanation requires a comma at the mathematical expression, before its label. Example: $$ x=y, (@eq:value) $$ then «где $x$ – величина.».`,
					file,
					formulaLine,
				),
			);
		}
		if (parsed.colon) {
			issues.push(
				issue(
					'where-colon',
					'STO 6.3.2 requires "где" without a colon in a formula explanation. Example: «где $x$ – величина.».',
					file,
					whereLine,
				),
			);
		}
		if (
			parsed.definitions
				.slice(0, -1)
				.some(definition => !definition.endsWith(';'))
		) {
			issues.push(
				issue(
					'formula-where-definition-separator',
					'Structured formula explanations should separate definitions with semicolons (project convention following the STO example). Example: «где $x$ – числитель; $y$ – знаменатель.».',
					file,
					whereLine,
					'warning',
				),
			);
		}
		if (!hasExplanationFinalPeriod(parsed.definitions.at(-1) ?? '')) {
			issues.push(
				issue(
					'formula-where-final-period',
					'Structured formula explanation should end with a period, not merely contain one in an abbreviation (project convention following the STO example). Example: «где $x$ – значение в усл. единицах.».',
					file,
					whereLine,
					'warning',
				),
			);
		}
	}
}
