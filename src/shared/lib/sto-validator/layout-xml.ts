import { STO_RULES } from '../../config';
import { getEffectiveBodyParagraphAttribute } from '../docx/styles';
import {
	extractWordText,
	getBodyElements,
	getParagraphStyleId,
	getReportTables,
	isParagraphXml,
} from './body-xml';
import { isMathLayoutTable } from './math-layout-table';

export function countEmptyTableCells(docXml: string): number {
	let empty = 0;
	for (const table of getReportTables(docXml)) {
		if (isMathLayoutTable(table)) continue;
		for (const cell of table.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? []) {
			const properties =
				/<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/.exec(cell)?.[1] ?? '';
			// A continuation of a merged cell is not an absent data value.
			const mergedContinuation = [
				...properties.matchAll(/<w:(?:vMerge|hMerge)\b[^>]*>/g),
			].some(match => {
				const value = getXmlAttribute(match[0], 'w:val');
				return value === null || value === 'continue';
			});
			if (
				!mergedContinuation &&
				extractWordText(cell).trim().length === 0 &&
				!/<m:oMath\b|<w:drawing\b/.test(cell)
			)
				empty++;
		}
	}
	return empty;
}

export function countTablesWithDiagonalBorders(docXml: string): number {
	return getReportTables(docXml).filter(
		table =>
			!isMathLayoutTable(table) &&
			[...table.matchAll(/<w:(?:tl2br|tr2bl)\b[^>]*>/g)].some(
				match =>
					!['none', 'nil'].includes(
						getXmlAttribute(match[0], 'w:val') ?? '',
					),
			),
	).length;
}

interface KeywordIndentInput {
	docXml: string;
	stylesXml: string;
	numberingXml: string | null;
}

function getXmlAttribute(tagXml: string, attributeName: string): string | null {
	const match = new RegExp(`${attributeName}="([^"]+)"`).exec(tagXml);
	return match?.[1] ?? null;
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

		const rows = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
		for (const [index, rowXml] of rows.entries()) {
			const rowProperties =
				/<w:trPr\b[\s\S]*?<\/w:trPr>/.exec(rowXml)?.[0] ?? '';
			const repeat = /<w:tblHeader\b[^>]*>/.exec(rowProperties)?.[0];
			if (
				index > 0 &&
				(!repeat || /\bw:val="(?:0|false|off)"/.test(repeat))
			)
				break;
			const cells = rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
			cellsWithFinalPeriod += cells.filter(cellXml =>
				/[.]$/.test(extractWordText(cellXml).trim()),
			).length;
		}
	}

	return cellsWithFinalPeriod;
}
