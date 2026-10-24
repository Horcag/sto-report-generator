import { Lexer } from 'marked';

import { STO_RULES } from '@/shared/config';

import { maskSourceCodeFences } from './text-context';
import { SourcePreflightIssue } from './types';
import {
	isMarkdownTableSeparator,
	issue,
	splitMarkdownTableRow,
} from './utils';

export function validateMarkdownTables(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const searchable = maskSourceCodeFences(content);
	const lines = searchable.split('\n');
	const bodyRowCounts = new Map<number, number>();
	const nonTableLines = new Set<number>();
	let tokenLine = 0;
	for (const token of Lexer.lex(searchable)) {
		const newlineCount = token.raw.split('\n').length - 1;
		if (token.type === 'table') {
			bodyRowCounts.set(tokenLine, token.rows.length);
		} else if (token.type === 'html' || token.type === 'code') {
			const lastLine = tokenLine + newlineCount;
			for (let index = tokenLine; index <= lastLine; index++) {
				if (index === lastLine && token.raw.endsWith('\n')) break;
				nonTableLines.add(index);
			}
		}
		tokenLine += newlineCount;
	}

	for (let i = 0; i < lines.length - 1; i++) {
		if (nonTableLines.has(i) || nonTableLines.has(i + 1)) continue;
		const headerCells = splitMarkdownTableRow(lines[i]);
		if (!bodyRowCounts.has(i) && !lines[i].includes('|')) continue;
		const separatorCells = splitMarkdownTableRow(lines[i + 1]);
		const validSeparator = isMarkdownTableSeparator(lines[i + 1]);
		// A row containing a delimiter cell is an unambiguous table attempt;
		// arbitrary prose containing pipes must not become a malformed table.
		const separatorAttempt =
			lines[i + 1].includes('|') &&
			separatorCells.some(cell => /^:?-+:?$/.test(cell));
		if (!validSeparator && !separatorAttempt) continue;
		if (!validSeparator) {
			issues.push(
				issue(
					'table-invalid-separator',
					'table separator cells must contain dashes with optional alignment colons at the edges.',
					file,
					i + 2,
				),
			);
		}
		if (headerCells.length !== separatorCells.length) {
			issues.push(
				issue(
					'table-header-column-count',
					`table header has ${headerCells.length} cells but its separator has ${separatorCells.length}; both must have the same number of columns.`,
					file,
					i + 2,
				),
			);
		}
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

		// Marked normalizes body rows to the header width, losing extra cells
		// and padding missing ones. Inspect the original rows before that loss.
		const rowCount = bodyRowCounts.get(i) ?? 0;
		for (let offset = 0; offset < rowCount; offset++) {
			const rowIndex = i + 2 + offset;
			const cells = splitMarkdownTableRow(lines[rowIndex]);
			if (cells.length !== headerCells.length) {
				issues.push(
					issue(
						'table-row-column-count',
						`table row has ${cells.length} cells; expected ${headerCells.length}. Markdown would truncate extra cells or pad missing cells. Escape literal pipes as \\|, including inside code or math.`,
						file,
						rowIndex + 1,
					),
				);
			}
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
		i += rowCount + 1;
	}
}
