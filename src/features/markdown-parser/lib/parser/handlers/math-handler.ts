import { convertLatex2Math } from '@hungknguyen/docx-math-converter';
import {
	AlignmentType,
	BorderStyle,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';

import { MathConversionResult, ParserContext } from '../../types';

/**
 * Handles block math ($$ ... $$) and converts it to a Docx Table for centering and numbering.
 */
export async function handleBlockMath(
	mathContent: string,
	context: ParserContext,
): Promise<Table> {
	const numberMatch = mathContent.match(/^(.*?)\s*\((@eq:[a-zA-Z0-9_-]+)\)$/);
	let formula = mathContent;
	let eqNumber = '';

	if (numberMatch) {
		formula = numberMatch[1].trim();
		const eqId = numberMatch[2].trim();
		eqNumber = `(${context.itemMap.has(eqId) ? String(context.itemMap.get(eqId)) : '?'})`;
	} else {
		const plainNumMatch = mathContent.match(/^(.*?)\s*(\(\d+\))$/);
		if (plainNumMatch) {
			formula = plainNumMatch[1].trim();
			eqNumber = plainNumMatch[2].trim();
		}
	}

	let formulaMath: MathConversionResult;
	try {
		formulaMath = (await convertLatex2Math(
			formula,
		)) as MathConversionResult;
	} catch {
		formulaMath = new TextRun({ text: formula, italics: true });
	}

	return new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		borders: {
			top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
			bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
			left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
			right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
			insideHorizontal: {
				style: BorderStyle.NONE,
				size: 0,
				color: 'auto',
			},
			insideVertical: {
				style: BorderStyle.NONE,
				size: 0,
				color: 'auto',
			},
		},
		rows: [
			new TableRow({
				children: [
					new TableCell({
						width: { size: 15, type: WidthType.PERCENTAGE },
						children: [new Paragraph('')],
					}),
					new TableCell({
						width: { size: 70, type: WidthType.PERCENTAGE },
						children: [
							new Paragraph({
								alignment: AlignmentType.CENTER,
								children: [formulaMath],
							}),
						],
					}),
					new TableCell({
						width: { size: 15, type: WidthType.PERCENTAGE },
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [new TextRun(eqNumber)],
							}),
						],
					}),
				],
			}),
		],
	});
}
