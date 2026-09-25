import { STO_RULES } from '../../config';
import { getEffectiveBodyParagraphAttribute } from '../word-style-properties';
import {
	extractWordText,
	getBodyElements,
	getParagraphStyleId,
	getReportTables,
	isParagraphXml,
} from './body-xml';

interface KeywordIndentInput {
	docXml: string;
	stylesXml: string;
	numberingXml: string | null;
}

function getXmlAttribute(tagXml: string, attributeName: string): string | null {
	const match = new RegExp(`${attributeName}="([^"]+)"`).exec(tagXml);
	return match?.[1] ?? null;
}

function isMathLayoutTable(tableXml: string): boolean {
	return tableXml.includes('<m:' + 'oMath');
}

function getCellMarginDxa(
	propertiesXml: string,
	container: string,
	side: string,
): number | null {
	const margins = new RegExp(
		`<w:${container}\\b[\\s\\S]*?<\\/w:${container}>`,
	).exec(propertiesXml)?.[0];
	const sideTag =
		margins &&
		new RegExp(`<w:${side}\\b[^>]*\\/?>(?:<\\/w:${side}>)?`).exec(
			margins,
		)?.[0];
	if (!sideTag || getXmlAttribute(sideTag, 'w:type') !== 'dxa') return null;
	const width = Number(getXmlAttribute(sideTag, 'w:w'));
	return Number.isFinite(width) ? width : null;
}

export function countTableCellsWithInsufficientPadding(docXml: string): number {
	let insufficient = 0;
	const minimums = { top: 57, bottom: 57, left: 108, right: 108 };
	for (const tableXml of getReportTables(docXml)) {
		if (isMathLayoutTable(tableXml)) continue;
		const tableProperties =
			/<w:tblPr\b[\s\S]*?<\/w:tblPr>/.exec(tableXml)?.[0] ?? '';
		for (const cellXml of tableXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ??
			[]) {
			const cellProperties =
				/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(cellXml)?.[0] ?? '';
			const hasInsufficientSide = Object.entries(minimums).some(
				([side, minimum]) => {
					const cellMargin = getCellMarginDxa(
						cellProperties,
						'tcMar',
						side,
					);
					const tableMargin = getCellMarginDxa(
						tableProperties,
						'tblCellMar',
						side,
					);
					return (cellMargin ?? tableMargin ?? 0) < minimum;
				},
			);
			if (hasInsufficientSide) insufficient++;
		}
	}
	return insufficient;
}

export function countReferatKeywordsWithWrongIndent(
	input: KeywordIndentInput,
): number {
	let inReferat = false;
	let wrongIndent = 0;
	for (const paragraphXml of getBodyElements(input.docXml)) {
		if (!isParagraphXml(paragraphXml)) continue;
		const text = extractWordText(paragraphXml).trim();
		const uppercase = text.toLocaleUpperCase('ru-RU');
		if (uppercase === 'РЕФЕРАТ') {
			inReferat = true;
			continue;
		}
		if (uppercase === 'СОДЕРЖАНИЕ' || uppercase === 'ВВЕДЕНИЕ') {
			inReferat = false;
		}
		if (!inReferat || !text.includes(',') || text !== uppercase) continue;
		const keywordCount = text
			.replace(/[.]$/, '')
			.split(',')
			.filter(Boolean).length;
		if (
			keywordCount < STO_RULES.referat.keywordCount.min ||
			keywordCount > STO_RULES.referat.keywordCount.max
		)
			continue;
		const styleId = getParagraphStyleId(paragraphXml) ?? 'Normal';
		const effectiveIndent = getEffectiveBodyParagraphAttribute(
			paragraphXml,
			input.stylesXml,
			input.numberingXml,
			styleId,
			'ind',
			'firstLine',
		);
		if (effectiveIndent !== String(STO_RULES.typography.firstLineIndentDxa))
			wrongIndent++;
	}
	return wrongIndent;
}

export function countTableHeaderFinalPeriods(docXml: string): number {
	const tables = getReportTables(docXml);
	let cellsWithFinalPeriod = 0;

	for (const tableXml of tables) {
		if (isMathLayoutTable(tableXml)) {
			continue;
		}

		const firstRow = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
		if (!firstRow) {
			continue;
		}

		const cells = firstRow.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
		cellsWithFinalPeriod += cells.filter(cellXml =>
			/[.]$/.test(extractWordText(cellXml).trim()),
		).length;
	}

	return cellsWithFinalPeriod;
}
