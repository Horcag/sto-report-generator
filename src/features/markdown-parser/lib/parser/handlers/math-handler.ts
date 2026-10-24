import {
	AlignmentType,
	BorderStyle,
	ImportedXmlComponent,
	Paragraph,
	Table,
	TableCell,
	TableRow,
	TextRun,
	VerticalAlign,
	WidthType,
} from 'docx';

import { STO_RULES } from '@/shared/config';
import { convertLatex2Math, splitDisplayMathLines } from '@/shared/lib/math';

import { MathConversionResult, ParserContext } from '../../types';

/**
 * Handles block math ($$ ... $$) and converts it to a Docx Table for centering and numbering.
 */
export async function handleBlockMath(
	mathContent: string,
	context: ParserContext,
	keepWithExplanation = false,
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

	const lines = splitDisplayMathLines(formula);
	const blankLineTwips = STO_RULES.typography.fontSizePoints * 20;
	const rows = lines.map((line, index) => {
		const keepNext = index < lines.length - 1 || keepWithExplanation;
		const formulaMath: MathConversionResult = convertLatex2Math(line);
		// A standalone equation is display math even inside its numbering table.
		// Bare oMath denotes inline math to readers that do not infer this from layout.
		const displayMath = new ImportedXmlComponent('m:oMathPara');
		const displayProperties = new ImportedXmlComponent('m:oMathParaPr');
		displayProperties.push(
			new ImportedXmlComponent('m:jc', { 'm:val': 'center' }),
		);
		displayMath.push(displayProperties);
		displayMath.push(formulaMath);
		const formulaParagraph = new Paragraph({
			alignment: AlignmentType.CENTER,
			indent: { firstLine: 0, left: 0, right: 0 },
			spacing: { before: 0, after: 0, line: 240 },
			keepNext,
		});
		formulaParagraph.addChildElement(displayMath);
		const margins = {
			top: index === 0 ? blankLineTwips : 0,
			bottom: index === lines.length - 1 ? blankLineTwips : 0,
			left: 0,
			right: 0,
		};
		return new TableRow({
			cantSplit: true,
			children: [
				new TableCell({
					width: { size: 15, type: WidthType.PERCENTAGE },
					margins,
					children: [
						new Paragraph({
							indent: { firstLine: 0, left: 0, right: 0 },
							spacing: { before: 0, after: 0, line: 240 },
							keepNext,
						}),
					],
				}),
				new TableCell({
					width: { size: 70, type: WidthType.PERCENTAGE },
					margins,
					children: [formulaParagraph],
				}),
				new TableCell({
					width: { size: 15, type: WidthType.PERCENTAGE },
					verticalAlign: VerticalAlign.CENTER,
					margins,
					children: [
						new Paragraph({
							alignment: AlignmentType.RIGHT,
							indent: { firstLine: 0, left: 0, right: 0 },
							spacing: { before: 0, after: 0, line: 240 },
							keepNext,
							children: [
								new TextRun({
									text:
										index === lines.length - 1
											? eqNumber
											: '',
									italics: false,
								}),
							],
						}),
					],
				}),
			],
		});
	});

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
		rows,
	});
}
