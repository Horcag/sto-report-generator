import { JSDOM } from 'jsdom';

import {
	hasExplanationFinalPeriod,
	inspectFormulaExplanation,
	startsSymbolDefinition,
} from '../math/formula-punctuation';
import { isMathLayoutTable } from './math-layout-table';

const ACCENT_MARKS = new Set(['¯', '―', '~', '˜', '^', '→', '˙', '¨']);
const UPRIGHT_LIMIT_OPERATORS = new Set(['min', 'max', 'lim', 'inf', 'sup']);

export function inspectMathStructures(documentXml: string): {
	accentLimits: number;
	italicLimitOperators: number;
	unparsedLatex: boolean;
} {
	const document = new JSDOM(documentXml, { contentType: 'text/xml' }).window
		.document;
	let accentLimits = 0;
	let italicLimitOperators = 0;
	for (const upperLimit of [...document.getElementsByTagName('m:limUpp')]) {
		const limit = [...upperLimit.children].find(
			child => child.tagName === 'm:lim',
		);
		if (limit && ACCENT_MARKS.has(limit.textContent?.trim() ?? '')) {
			accentLimits++;
		}
	}
	for (const kind of ['m:limLow', 'm:limUpp']) {
		for (const limit of [...document.getElementsByTagName(kind)]) {
			const base = [...limit.children].find(
				child => child.tagName === 'm:e',
			);
			const runs = base ? [...base.getElementsByTagName('m:r')] : [];
			if (runs.length !== 1) continue;
			const run = runs[0];
			if (!UPRIGHT_LIMIT_OPERATORS.has(run.textContent?.trim() ?? '')) {
				continue;
			}
			const properties = [...run.children].find(
				child => child.tagName === 'm:rPr',
			);
			if (
				!properties ||
				![...properties.children].some(
					child => child.tagName === 'm:nor',
				)
			) {
				italicLimitOperators++;
			}
		}
	}
	const unparsedLatex = [...document.getElementsByTagName('w:p')].some(
		paragraph => {
			const prose = [...paragraph.getElementsByTagName('w:r')]
				.filter(run => {
					const fonts = run.getElementsByTagName('w:rFonts')[0];
					return !['w:ascii', 'w:hAnsi'].some(
						attribute =>
							fonts?.getAttribute(attribute) === 'Courier New',
					);
				})
				.map(run =>
					[...run.getElementsByTagName('w:t')]
						.map(text => text.textContent ?? '')
						.join(''),
				)
				.join('');
			return /\$\$|\$[^$]+\$/.test(prose);
		},
	);
	return { accentLimits, italicLimitOperators, unparsedLatex };
}

interface PunctuationBlock {
	kind: 'formula' | 'text' | 'barrier';
	text: string;
	paragraph: number;
}

function mathEnding(element: Element): string {
	const children = [...element.children].filter(
		child => !child.tagName.endsWith('Pr'),
	);
	const last = children.at(-1);
	if (!last) return '';
	if (last.tagName === 'm:r') return last.textContent?.trimEnd().at(-1) ?? '';
	// In a multiline equation the last row owns punctuation. Delimiters, fractions,
	// scripts and matrices are not final punctuation, even if an inner run ends in ','.
	if (['m:oMath', 'm:e', 'm:eqArr'].includes(last.tagName))
		return mathEnding(last);
	return '';
}

function proseText(element: Element): string {
	if (
		element.tagName === 'w:r' &&
		[...element.getElementsByTagName('w:rFonts')].some(fonts =>
			['w:ascii', 'w:hAnsi'].some(
				attribute => fonts.getAttribute(attribute) === 'Courier New',
			),
		)
	)
		return '\uFFFC';
	if (element.tagName === 'm:oMath') return `⟦${element.textContent ?? ''}⟧`;
	if (['w:t', 'm:t'].includes(element.tagName))
		return element.textContent ?? '';
	if (['w:br', 'w:cr'].includes(element.tagName)) return '\n';
	return [...element.children].map(proseText).join('');
}

function formulaEnding(paragraph: Element): string | null {
	const maths = [...paragraph.getElementsByTagName('m:oMath')];
	if (maths.length !== 1) return null;
	const math = maths[0];
	const outside = [...paragraph.getElementsByTagName('w:t')]
		.filter(text => !math.contains(text))
		.map(text => text.textContent ?? '')
		.join('')
		.trim();
	// A display paragraph may carry punctuation outside OMML, before its number.
	if (
		!/^[,;.]?\s*(?:\((?:[A-ZА-ЯЁ]\.)?\d+(?:\.\d+)*\)[,;.]?)?$/u.test(
			outside,
		)
	)
		return null;
	const texts = [...paragraph.getElementsByTagName('*')].filter(element =>
		['m:t', 'w:t'].includes(element.tagName),
	);
	const lastMathText = [...math.getElementsByTagName('m:t')].at(-1);
	const after = lastMathText
		? texts
				.slice(texts.indexOf(lastMathText) + 1)
				.filter(text => !math.contains(text))
				.map(text => text.textContent ?? '')
				.join('')
				.trim()
		: '';
	return /^[,;.]/u.exec(after)?.[0] ?? mathEnding(math);
}

export function inspectFormulaPunctuation(docXml: string): {
	beforeWhere: number[];
	whereColon: number[];
	consecutive: number[];
	definitionSeparators: number[];
	finalPeriod: number[];
} {
	const document = new JSDOM(docXml, { contentType: 'text/xml' }).window
		.document;
	const paragraphs = [...document.getElementsByTagName('w:p')];
	const blocks: PunctuationBlock[] = [];
	const appendParagraph = (paragraph: Element): void => {
		const position = paragraphs.indexOf(paragraph) + 1;
		if (paragraph.getElementsByTagName('w:drawing').length) {
			blocks.push({ kind: 'barrier', text: '', paragraph: position });
			return;
		}
		const ending = formulaEnding(paragraph);
		if (ending !== null) {
			blocks.push({ kind: 'formula', text: ending, paragraph: position });
		} else {
			const text = proseText(paragraph).trim();
			if (text) blocks.push({ kind: 'text', text, paragraph: position });
		}
	};
	const appendContainer = (container: Element): void => {
		for (const element of [...container.children]) {
			if (element.tagName === 'w:p') appendParagraph(element);
			else if (element.tagName === 'w:tbl') {
				if (isMathLayoutTable(element.outerHTML)) {
					const rows = [...element.children].filter(
						child => child.tagName === 'w:tr',
					);
					for (const [rowIndex, row] of rows.entries()) {
						const cells = [...row.children].filter(
							child => child.tagName === 'w:tc',
						);
						const cell = cells[1];
						// Explicit continuation rows are kept with their next row; only
						// the final row owns the equation's sentence punctuation.
						const continued = [
							...cell.getElementsByTagName('w:keepNext'),
						].some(
							property =>
								!['0', 'false', 'off'].includes(
									property.getAttribute('w:val') ?? '',
								),
						);
						if (
							continued &&
							rowIndex < rows.length - 1 &&
							!proseText(cells[2]).trim()
						)
							continue;
						appendContainer(cell);
					}
				} else {
					// Each data-table cell is its own text flow; never link unrelated cells.
					blocks.push({ kind: 'barrier', text: '', paragraph: 0 });
					for (const cell of [
						...element.getElementsByTagName('w:tc'),
					].filter(
						cell => cell.parentElement?.parentElement === element,
					)) {
						appendContainer(cell);
						blocks.push({
							kind: 'barrier',
							text: '',
							paragraph: 0,
						});
					}
				}
			}
		}
	};
	const body = document.getElementsByTagName('w:body')[0];
	if (body) appendContainer(body);
	const result = {
		beforeWhere: [] as number[],
		whereColon: [] as number[],
		consecutive: [] as number[],
		definitionSeparators: [] as number[],
		finalPeriod: [] as number[],
	};
	for (let index = 0; index < blocks.length - 1; index++) {
		const formula = blocks[index];
		const next = blocks[index + 1];
		if (formula.kind !== 'formula') continue;
		if (next.kind === 'formula' && !/[,;]/u.test(formula.text))
			result.consecutive.push(formula.paragraph);
		if (next.kind !== 'text') continue;
		const explanation = [next.text];
		for (let cursor = index + 2; cursor < blocks.length; cursor++) {
			const continuation = blocks[cursor];
			if (
				continuation.kind !== 'text' ||
				!startsSymbolDefinition(continuation.text)
			)
				break;
			explanation.push(continuation.text);
		}
		const parsed = inspectFormulaExplanation(explanation.join('\n'));
		if (!parsed) continue;
		if (formula.text !== ',') result.beforeWhere.push(formula.paragraph);
		if (parsed.colon) result.whereColon.push(next.paragraph);
		if (
			parsed.definitions
				.slice(0, -1)
				.some(definition => !definition.endsWith(';'))
		)
			result.definitionSeparators.push(next.paragraph);
		if (!hasExplanationFinalPeriod(parsed.definitions.at(-1) ?? ''))
			result.finalPeriod.push(next.paragraph);
	}
	return result;
}

/** Add the same deterministic punctuation rules to the existing DOCX validation suite. */
export function validateFormulaPunctuation(
	docXml: string,
): { check: string; passed: boolean; error?: string }[] {
	const punctuation = inspectFormulaPunctuation(docXml);
	const rules: [string, number[], string][] = [
		[
			'Formula Punctuation Before Where',
			punctuation.beforeWhere,
			'Block formula before a structured "где" explanation requires a comma at the expression, before its number. Example: x=y, (1) then «где x – величина.».',
		],
		[
			'Formula Where Colon',
			punctuation.whereColon,
			'STO 6.3.2 requires "где" without a colon. Example: «где x – величина.».',
		],
		[
			'Consecutive Formula Punctuation',
			punctuation.consecutive,
			'Consecutive block formulas without intervening text require a comma or semicolon (STO 6.3.2). Example: x=y; (1) followed by z=t.',
		],
		[
			'Formula Where Definition Separators',
			punctuation.definitionSeparators,
			'Structured formula explanation should separate definitions with semicolons (project convention following the STO example). Example: «где x – числитель; y – знаменатель.».',
		],
		[
			'Formula Where Final Period',
			punctuation.finalPeriod,
			'Structured formula explanation should end with a period (project convention following the STO example). An internal abbreviation dot is insufficient. Example: «где x – значение в усл. единицах.».',
		],
	];
	return rules.map(([check, paragraphs, message]) =>
		paragraphs.length
			? {
					check,
					passed: false,
					error: `${message} word/document.xml, paragraph(s): ${paragraphs.join(', ')}`,
				}
			: { check, passed: true },
	);
}
