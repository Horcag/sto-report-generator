import {
	createSourceTextContext,
	maskSourceCodeFences,
	maskSourceFrontmatter,
} from './text-context';
import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

const SUBSCRIPTED_SYMBOL_PATTERN =
	/(?<![\w./\\])([A-Za-z])[_^](?:\{[A-Za-z0-9,+-]{1,3}\}|[A-Za-z0-9]{1,3})(?![\w])/gu;
const NUMERIC_SLASH_FRACTION_PATTERN =
	/\b\d+(?:[,.]\d+)?\s*\/\s*\d+(?:[,.]\d+)?\b/g;

function looksLikeFileName(
	content: string,
	start: number,
	end: number,
): boolean {
	const before = content[start - 1] ?? '';
	const after = content[end] ?? '';
	return (
		before === '/' ||
		before === '\\' ||
		/^\.[A-Za-z0-9]{1,8}(?:\b|$)/.test(content.slice(end)) ||
		after === '/' ||
		after === '\\'
	);
}

function inspectText(
	file: string,
	content: string,
	text: string,
	baseIndex: number,
	issues: SourcePreflightIssue[],
): void {
	const prose = createSourceTextContext(text).prose;
	for (const match of prose.matchAll(SUBSCRIPTED_SYMBOL_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (looksLikeFileName(text, start, end)) continue;
		issues.push(
			issue(
				'raw-math-identifier',
				`appears to contain unmarked math identifier "${match[0]}". Wrap it in inline math, for example $${match[0]}$.`,
				file,
				lineNumberAt(content, baseIndex + start),
				'warning',
			),
		);
	}

	for (const match of prose.matchAll(NUMERIC_SLASH_FRACTION_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (looksLikeFileName(text, start, end)) continue;
		issues.push(
			issue(
				'raw-math-slash-fraction',
				`contains numeric slash expression "${match[0]}". If it is a fraction, mark it as math and use fraction notation such as $\\frac{${match[0].split('/')[0].trim()}}{${match[0].split('/')[1].trim()}}$.`,
				file,
				lineNumberAt(content, baseIndex + start),
				'warning',
			),
		);
	}
}

function inspectTableCells(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const scanContent = maskSourceFrontmatter(maskSourceCodeFences(content));
	let lineStart = 0;
	for (const scanLine of scanContent.split(/(?<=\n)/)) {
		const value = scanLine.replace(/\r?\n$/, '');
		const line = content
			.slice(lineStart, lineStart + scanLine.length)
			.replace(/\r?\n$/, '');
		if (/^\s*\|.*\|\s*$/.test(value)) {
			const baseIndex = lineStart;
			const cells = line
				.replace(/^\s*\|/, '')
				.replace(/\|\s*$/, '')
				.split('|');
			let cursor = line.indexOf('|') + 1;
			for (const cell of cells) {
				const offset = line.indexOf(cell, cursor);
				inspectText(file, content, cell, baseIndex + offset, issues);
				cursor = offset + cell.length + 1;
			}
		}
		lineStart += scanLine.length;
	}
}

export function validateRawMath(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const prose = createSourceTextContext(content).prose;
	inspectText(file, content, prose, 0, issues);
	inspectTableCells(file, content, issues);
}
