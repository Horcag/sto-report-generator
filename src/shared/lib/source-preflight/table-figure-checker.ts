import { STO_RULES } from '@/shared/config';

import { SourceFile, SourcePreflightIssue } from './types';
import {
	isMarkdownTableSeparator,
	issue,
	splitMarkdownTableRow,
} from './utils';

export function validateTableAndFigureOrder(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
): void {
	let textSoFar = '';

	for (const { file, content } of files) {
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const tableMatch = /^Таблица\s+(\d+)\s+–/i.exec(line);
			if (tableMatch) {
				const tableNum = tableMatch[1];
				const refRegex = new RegExp(
					`(?:таблиц[а-я]{1,3}|таблица)\\s+${tableNum}`,
					'i',
				);
				if (!refRegex.test(textSoFar)) {
					issues.push(
						issue(
							'table-before-reference',
							`Table ${tableNum} appears before being referenced in text. Found: "${line}"`,
							file,
							i + 1,
						),
					);
				}
			}

			const figMatch = /^Рисунок\s+(\d+)\s+–/i.exec(line);
			if (figMatch) {
				const figNum = figMatch[1];
				const refRegex = new RegExp(
					`(?:рисунк[а-я]{1,3}|рисунок)\\s+${figNum}`,
					'i',
				);
				if (!refRegex.test(textSoFar)) {
					issues.push(
						issue(
							'figure-before-reference',
							`Figure ${figNum} appears before being referenced in text. Found: "${line}"`,
							file,
							i + 1,
						),
					);
				}
			}

			textSoFar += `${line}\n`;
		}
	}
}

export function validateMarkdownTables(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const lines = content.split('\n');
	for (let i = 0; i < lines.length - 1; i++) {
		if (
			!lines[i].trim().startsWith('|') ||
			!isMarkdownTableSeparator(lines[i + 1])
		) {
			continue;
		}

		const headerCells = splitMarkdownTableRow(lines[i]);
		for (const cell of headerCells) {
			if (cell.length === 0) {
				issues.push(
					issue(
						'table-empty-header-cell',
						'table header cells must not be empty.',
						file,
						i + 1,
					),
				);
			}
			if (/\.\s*$/.test(cell)) {
				issues.push(
					issue(
						'table-header-final-period',
						'table header and subheader cells must not end with a final dot.',
						file,
						i + 1,
					),
				);
			}
			if (
				STO_RULES.tables.discouragedOrdinalHeaders.some(
					header => cell.toLowerCase() === header.toLowerCase(),
				)
			) {
				issues.push(
					issue(
						'table-discouraged-ordinal-header',
						`STO discourages ordinal table headers like "${cell}". Prefer a meaningful row label.`,
						file,
						i + 1,
						'warning',
					),
				);
			}
		}

		let rowIndex = i + 2;
		while (
			rowIndex < lines.length &&
			lines[rowIndex].trim().startsWith('|')
		) {
			if (!isMarkdownTableSeparator(lines[rowIndex])) {
				const cells = splitMarkdownTableRow(lines[rowIndex]);
				if (cells.some(cell => cell.length === 0)) {
					issues.push(
						issue(
							'table-empty-source-cell',
							'table cells must not be empty. Use an en-dash when data is absent.',
							file,
							rowIndex + 1,
						),
					);
				}
			}
			rowIndex++;
		}
	}
}
