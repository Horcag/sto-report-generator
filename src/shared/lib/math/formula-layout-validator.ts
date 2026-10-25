import { JSDOM } from 'jsdom';

import { getEffectiveBodyParagraphAttribute } from '../docx/styles';
import type { ValidationResult } from '../sto-validator';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NUMBER = /^\((?:[A-ZА-ЯЁ]\.)?\d+(?:\.\d+)*\)[,;.]?$/u;

function children(
	element: Element,
	namespace: string,
	name: string,
): Element[] {
	return [...element.children].filter(
		child => child.namespaceURI === namespace && child.localName === name,
	);
}

function descendants(
	element: Element,
	namespace: string,
	name: string,
): Element[] {
	return [...element.getElementsByTagNameNS(namespace, name)];
}

function wordAttribute(
	element: Element | undefined,
	name: string,
): string | null {
	return element?.getAttributeNS(WORD_NS, name) ?? null;
}

function text(element: Element, namespace: string): string {
	return descendants(element, namespace, 't')
		.map(item => item.textContent ?? '')
		.join('')
		.trim();
}

function hasVisibleObject(element: Element): boolean {
	return ['drawing', 'pict', 'object', 'tab', 'br', 'cr'].some(
		name => descendants(element, WORD_NS, name).length > 0,
	);
}

function isInvisible(table: Element): boolean {
	return ['tblBorders', 'tcBorders'].every(name =>
		descendants(table, WORD_NS, name).every(borders =>
			[...borders.children].every(border =>
				['none', 'nil'].includes(wordAttribute(border, 'val') ?? ''),
			),
		),
	);
}

/** Identification deliberately does not depend on the layout properties being checked. */
function formulaRows(table: Element): Element[][] {
	if (
		descendants(table, WORD_NS, 'tbl').length ||
		descendants(table, WORD_NS, 'tblHeader').length ||
		!isInvisible(table)
	)
		return [];
	for (
		let ancestor = table.parentElement;
		ancestor;
		ancestor = ancestor.parentElement
	) {
		if (ancestor.namespaceURI === WORD_NS && ancestor.localName === 'tbl')
			return [];
	}
	const rows = children(table, WORD_NS, 'tr').map(row =>
		children(row, WORD_NS, 'tc'),
	);
	if (!rows.length) return [];
	return rows.every(cells => {
		if (cells.length !== 3) return false;
		const [left, formula, number] = cells;
		const label = text(number, WORD_NS) + text(number, MATH_NS);
		return (
			!hasVisibleObject(left) &&
			!hasVisibleObject(formula) &&
			!hasVisibleObject(number) &&
			text(left, WORD_NS) === '' &&
			descendants(left, MATH_NS, 'oMath').length === 0 &&
			/^[,;.]?$/u.test(text(formula, WORD_NS)) &&
			descendants(formula, MATH_NS, 'oMath').length > 0 &&
			(label === '' || NUMBER.test(label))
		);
	})
		? rows
		: [];
}

function paragraphAlignment(
	paragraph: Element,
	stylesXml: string,
): string | null {
	const properties = children(paragraph, WORD_NS, 'pPr')[0];
	const styleId =
		wordAttribute(
			properties && children(properties, WORD_NS, 'pStyle')[0],
			'val',
		) ?? 'Normal';
	return getEffectiveBodyParagraphAttribute(
		paragraph.outerHTML,
		stylesXml,
		null,
		styleId,
		'jc',
		'val',
	);
}

function centeredFormula(cell: Element, stylesXml: string): boolean {
	return children(cell, WORD_NS, 'p').every(paragraph => {
		if (!descendants(paragraph, MATH_NS, 'oMath').length) return true;
		return (
			paragraphAlignment(paragraph, stylesXml) === 'center' &&
			descendants(paragraph, MATH_NS, 'oMathPara').every(math => {
				const mathProperties = children(
					math,
					MATH_NS,
					'oMathParaPr',
				)[0];
				return (
					mathProperties &&
					children(mathProperties, MATH_NS, 'jc')[0]?.getAttributeNS(
						MATH_NS,
						'val',
					) === 'center'
				);
			})
		);
	});
}

function hasNonzeroIndent(cell: Element): boolean {
	return descendants(cell, WORD_NS, 'ind').some(indent =>
		['firstLine', 'hanging', 'left', 'right'].some(name => {
			const value = wordAttribute(indent, name);
			return value !== null && Number(value) !== 0;
		}),
	);
}

function numberIsUpright(cell: Element): boolean {
	const italics = ['i', 'iCs'].flatMap(name =>
		descendants(cell, WORD_NS, name),
	);
	if (
		italics.some(
			italic =>
				!['0', 'false', 'off'].includes(
					wordAttribute(italic, 'val') ?? '',
				),
		)
	)
		return false;
	return descendants(cell, MATH_NS, 'r').every(run => {
		if (!text(run, MATH_NS)) return true;
		const properties = children(run, MATH_NS, 'rPr')[0];
		return (
			properties &&
			(children(properties, MATH_NS, 'nor').some(
				normal =>
					!['0', 'false', 'off'].includes(
						normal.getAttributeNS(MATH_NS, 'val') ?? '',
					),
			) ||
				children(properties, MATH_NS, 'sty')[0]?.getAttributeNS(
					MATH_NS,
					'val',
				) === 'p')
		);
	});
}

function rightMarginIsZero(table: Element, cell: Element): boolean {
	const cellProperties = children(cell, WORD_NS, 'tcPr')[0];
	const tableProperties = children(table, WORD_NS, 'tblPr')[0];
	const cellMargins =
		cellProperties && children(cellProperties, WORD_NS, 'tcMar')[0];
	const tableMargins =
		tableProperties && children(tableProperties, WORD_NS, 'tblCellMar')[0];
	const right =
		(cellMargins && children(cellMargins, WORD_NS, 'right')[0]) ??
		(tableMargins && children(tableMargins, WORD_NS, 'right')[0]);
	return (
		!right ||
		wordAttribute(right, 'type') === 'nil' ||
		wordAttribute(right, 'w') === '0'
	);
}

/** Validate identifiable equation wrappers, including rows merged into one table by Word. */
export function validateFormulaLayout(
	docXml: string,
	stylesXml = '',
): ValidationResult[] {
	const document = new JSDOM(docXml, { contentType: 'text/xml' }).window
		.document;
	const rules: [string, string, string[]][] = [
		[
			'Formula Horizontal Alignment',
			'Formula paragraphs and display math must be centered by direct or inherited formatting.',
			[],
		],
		[
			'Formula Number Vertical Alignment',
			'Equation number cells must be explicitly vertically centered.',
			[],
		],
		[
			'Formula Number Horizontal Alignment',
			'Equation number paragraphs must be right aligned by direct or inherited formatting.',
			[],
		],
		[
			'Formula Paragraph Indents',
			'Formula and number paragraphs must not use nonzero first-line, hanging, left or right indentation.',
			[],
		],
		[
			'Formula Number Upright',
			'Equation numbers must use upright text rather than italic text or default math italics.',
			[],
		],
		[
			'Formula Number Right Margin',
			'An explicit right margin on an equation number cell must be zero.',
			[],
		],
	];
	for (const [tableIndex, table] of [
		...document.getElementsByTagNameNS(WORD_NS, 'tbl'),
	].entries()) {
		for (const [rowIndex, [, formula, number]] of formulaRows(
			table,
		).entries()) {
			const numberProperties = children(number, WORD_NS, 'tcPr')[0];
			const valid = [
				centeredFormula(formula, stylesXml),
				wordAttribute(
					numberProperties &&
						children(numberProperties, WORD_NS, 'vAlign')[0],
					'val',
				) === 'center',
				children(number, WORD_NS, 'p').every(
					paragraph =>
						paragraphAlignment(paragraph, stylesXml) === 'right',
				),
				!hasNonzeroIndent(formula) && !hasNonzeroIndent(number),
				numberIsUpright(number),
				rightMarginIsZero(table, number),
			];
			valid.forEach((passed, index) => {
				if (!passed)
					rules[index][2].push(
						`table ${tableIndex + 1}, row ${rowIndex + 1}`,
					);
			});
		}
	}
	return rules.map(([check, message, failures]) =>
		failures.length
			? {
					check,
					passed: false,
					error: `${message} word/document.xml: ${failures.join('; ')}.`,
				}
			: { check, passed: true },
	);
}
