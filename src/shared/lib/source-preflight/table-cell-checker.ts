import { inspectTableNoteRows } from '../sto-validator/table-note-rows';
import type { SourcePreflightIssue } from './types';
import { issue } from './utils';

const decimal = /^[+−-]?\d+\.\d+(?:[eE][+−-]?\d+)?$/u;
const numericOrSymbol =
	/^(?:[+−-]?\d+(?:[.,]\d+)?(?:[eE][+−-]?\d+)?(?:\s*%)?|[+−±×÷=<>≤≥≈≠%№°])$/u;
const repetitionQuote = /^(?:"|»|〃)$/u;
const singleNote = /^Примечание\s+[–—-]\s+\S/u;

export function validateTableCellContent(
	file: string,
	headers: string[],
	rows: string[][],
	firstRowLine: number,
	issues: SourcePreflightIssue[],
): void {
	for (const heading of headers) {
		// Restrict the signal to ordinary Cyrillic wording; symbols, markup and
		// mixed-case technical names require the author's interpretation.
		if (/^[а-яё][а-яё -]*$/u.test(heading))
			issues.push(
				issue(
					'table-heading-capitalization',
					`Table heading "${heading}" starts with a lowercase letter. Check capitalization while preserving established notation.`,
					file,
					firstRowLine - 2,
					'warning',
				),
			);
	}
	const firstCells = rows.map(cells => cells.find(cell => cell !== '') ?? '');
	const notes = inspectTableNoteRows(firstCells);
	for (const index of notes.invalidForms)
		issues.push(
			issue(
				'table-note-form',
				'Use "Примечание –" for a single note, or "Примечания" with at least two consecutive numbers without dots.',
				file,
				firstRowLine + index,
			),
		);
	for (const index of notes.beforeData)
		issues.push(
			issue(
				'table-note-before-data',
				'An explicit table note must follow the final data row.',
				file,
				firstRowLine + index,
			),
		);
	const repeatedTypes: boolean[] = [];
	for (const [index, cells] of rows.entries()) {
		const line = firstRowLine + index;
		if (
			singleNote.test(firstCells[index]) &&
			/^Примечание\s+[–—-]\s+[а-яё]{2}/u.test(firstCells[index])
		)
			issues.push(
				issue(
					'table-note-capitalization',
					'A table note normally starts its explanatory text with a capital letter. Preserve established symbol notation.',
					file,
					line,
					'warning',
				),
			);

		for (const [column, cell] of cells.entries()) {
			const dateColumn = /^(?:Дата|Date)(?:\s|$)/iu.test(
				headers[column] ?? '',
			);
			if (decimal.test(cell) && !dateColumn)
				issues.push(
					issue(
						'table-decimal-dot',
						`Numeric-looking table value "${cell}" uses a decimal point. Use a comma for decimal data; preserve intentional version or identifier notation.`,
						file,
						line,
						'warning',
					),
				);
			const quote = repetitionQuote.test(cell);
			if (quote && repeatedTypes[column])
				issues.push(
					issue(
						'table-quoted-numeric-repeat',
						'Quotation marks must not replace repeated numbers, marks or scientific signs. Repeat the value explicitly.',
						file,
						line,
						'warning',
					),
				);
			if (!quote) repeatedTypes[column] = numericOrSymbol.test(cell);
		}
	}
}
