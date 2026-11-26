import { JSDOM } from 'jsdom';

import {
	hasXmlAncestor,
	MARKUP_COMPATIBILITY_NS,
	NON_BODY_PROSE_ANCESTORS,
} from '../docx/xml-elements';
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
	unhiddenNaryLimits: number;
	detachedPrimes: number;
	unparsedLatex: boolean;
} {
	const document = new JSDOM(documentXml, { contentType: 'text/xml' }).window
		.document;
	const direct = (node: Element, tag: string): Element | undefined =>
		[...node.children].find(child => child.tagName === `m:${tag}`);
	const hidden = (node: Element): boolean => {
		for (
			let ancestor = node.parentElement;
			ancestor;
			ancestor = ancestor.parentElement
		) {
			if (ancestor.tagName !== 'm:phant') continue;
			const show = direct(ancestor, 'phantPr')?.getElementsByTagName(
				'm:show',
			)[0];
			if (
				show &&
				['0', 'false', 'off'].includes(show.getAttribute('m:val') ?? '')
			)
				return true;
		}
		return false;
	};
	let unhiddenNaryLimits = 0;
	for (const nary of [...document.getElementsByTagName('m:nary')]) {
		if (hidden(nary)) continue;
		for (const name of ['sub', 'sup']) {
			const index = direct(nary, name);
			const hide = direct(nary, 'naryPr')?.getElementsByTagName(
				`m:${name}Hide`,
			)[0];
			if (
				index &&
				!index.textContent?.trim() &&
				(!hide ||
					['0', 'false', 'off'].includes(
						hide.getAttribute('m:val') ?? '',
					))
			)
				unhiddenNaryLimits++;
		}
	}
	const detachedPrimes = [...document.getElementsByTagName('m:sSup')].filter(
		script => {
			if (hidden(script) || script.parentElement?.tagName !== 'm:sup')
				return false;
			const base = direct(script, 'e');
			const sup = direct(script, 'sup');
			return (
				base &&
				!base.textContent?.trim() &&
				[...base.children].every(child =>
					['m:r', 'm:argPr', 'm:ctrlPr'].includes(child.tagName),
				) &&
				sup &&
				[...sup.children].every(child => child.tagName === 'm:r') &&
				/^[′″‴⁗']+$/u.test(sup.textContent?.trim() ?? '')
			);
		},
	).length;
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
	const unparsedLatex = [...document.getElementsByTagName('w:p')]
		.filter(
			paragraph => !hasXmlAncestor(paragraph, NON_BODY_PROSE_ANCESTORS),
		)
		.some(paragraph => {
			const prose = [...paragraph.getElementsByTagName('w:r')]
				.filter(
					run =>
						!hasXmlAncestor(
							run,
							NON_BODY_PROSE_ANCESTORS,
							paragraph,
						),
				)
				.filter(run => {
					const fonts = run.getElementsByTagName('w:rFonts')[0];
					return !['w:ascii', 'w:hAnsi'].some(
						attribute =>
							fonts?.getAttribute(attribute) === 'Courier New',
					);
				})
				.map(run =>
					[...run.getElementsByTagName('w:t')]
						.filter(
							text =>
								!hasXmlAncestor(
									text,
									NON_BODY_PROSE_ANCESTORS,
									run,
								),
						)
						.map(text => text.textContent ?? '')
						.join(''),
				)
				.join('');
			return /\$\$|\$[^$]+\$/.test(prose);
		});
	return {
		accentLimits,
		italicLimitOperators,
		unhiddenNaryLimits,
		detachedPrimes,
		unparsedLatex,
	};
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
		['mc:Fallback', 'w:txbxContent', 'w:drawing', 'w:pict'].includes(
			element.tagName,
		)
	) {
		return '';
	}
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
		.filter(
			text =>
				!math.contains(text) &&
				!hasXmlAncestor(text, NON_BODY_PROSE_ANCESTORS, paragraph),
		)
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

/** Read sentence punctuation from the last display row, before the equation number. */
export function formulaEndsWithComma(
	elementXml: string,
	documentXml: string,
): boolean {
	// Word places extension namespaces on the document root, while body fragments
	// retain their prefixed attributes. Keep that complete namespace context.
	const opening = /<w:document\b[^>]*>/.exec(documentXml)?.[0];
	if (!opening)
		throw new Error('Formula punctuation requires a Word document root.');
	const dom = new JSDOM(`${opening}${elementXml}</w:document>`, {
		contentType: 'text/xml',
	});
	try {
		const paragraph = [...dom.window.document.getElementsByTagName('w:p')]
			.filter(value => value.getElementsByTagName('m:oMath').length > 0)
			.at(-1);
		return paragraph !== undefined && formulaEnding(paragraph) === ',';
	} finally {
		dom.window.close();
	}
}

export function inspectFormulaPunctuation(
	docXml: string,
	stylesXml = '',
): {
	beforeWhere: number[];
	whereColon: number[];
	consecutive: number[];
	definitionSeparators: number[];
	finalPeriod: number[];
} {
	const document = new JSDOM(docXml, { contentType: 'text/xml' }).window
		.document;
	const paragraphs = [...document.getElementsByTagName('w:p')].filter(
		paragraph => !hasXmlAncestor(paragraph, NON_BODY_PROSE_ANCESTORS),
	);
	const blocks: PunctuationBlock[] = [];
	const appendParagraph = (paragraph: Element): void => {
		const position = paragraphs.indexOf(paragraph) + 1;
		const hasActiveDrawing = [
			...paragraph.getElementsByTagName('w:drawing'),
		].some(
			drawing =>
				!hasXmlAncestor(
					drawing,
					[[MARKUP_COMPATIBILITY_NS, 'Fallback']],
					paragraph,
				),
		);
		if (hasActiveDrawing) {
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
				if (isMathLayoutTable(element.outerHTML, stylesXml)) {
					const rows = [...element.children].filter(
						child => child.tagName === 'w:tr',
					);
					for (const [rowIndex, row] of rows.entries()) {
						const cells = [...row.children].filter(
							child => child.tagName === 'w:tc',
						);
						const cell = cells.length === 1 ? cells[0] : cells[1];
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
							(cells.length === 1 || !proseText(cells[2]).trim())
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
	stylesXml = '',
): { check: string; passed: boolean; error?: string }[] {
	const punctuation = inspectFormulaPunctuation(docXml, stylesXml);
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
