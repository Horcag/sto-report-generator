import {
	AlignmentType,
	BorderStyle,
	ImportedXmlComponent,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from 'docx';

import { convertLatex2Math } from '@/shared/lib/math';

import { MathConversionResult, ParserContext } from '../../types';

/**
 * Handles block math ($$ ... $$) and converts it to a Docx Table for centering and numbering.
 */
export async function handleBlockMath(
	mathContent: string,
	context: ParserContext,
): Promise<Table> {
	const numberMatch = mathContent.match(
		/^([\s\S]*?)\s*\((@eq:[a-zA-Z0-9_-]+)\)$/,
	);
	let formula = mathContent;
	let eqNumber = '';

	if (numberMatch) {
		formula = numberMatch[1].trim();
		const eqId = numberMatch[2].trim();
		eqNumber = `(${context.itemMap.has(eqId) ? String(context.itemMap.get(eqId)) : '?'})`;
	} else {
		const plainNumMatch = mathContent.match(/^([\s\S]*?)\s*(\(\d+\))$/);
		if (plainNumMatch) {
			formula = plainNumMatch[1].trim();
			eqNumber = plainNumMatch[2].trim();
		}
	}

	const formulaMath: MathConversionResult = convertLatex2Math(formula);
	// A standalone equation is display math even inside its numbering table.
	// Bare oMath denotes inline math to readers that do not infer this from layout.
	const displayMath = new ImportedXmlComponent('m:oMathPara');
	const displayProperties = new ImportedXmlComponent('m:oMathParaPr');
	displayProperties.push(
		new ImportedXmlComponent('m:jc', { 'm:val': 'center' }),
	);
	displayMath.push(displayProperties);
	displayMath.push(formulaMath);
	const formulaParagraph = new Paragraph({ alignment: AlignmentType.CENTER });
	formulaParagraph.addChildElement(displayMath);

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
						children: [formulaParagraph],
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
