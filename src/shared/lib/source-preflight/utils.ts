import { SourcePreflightIssue, SourcePreflightSeverity } from './types';

export function lineNumberAt(content: string, index: number): number {
	return content.slice(0, index).split('\n').length;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function issue(
	code: string,
	message: string,
	file?: string,
	line?: number,
	severity: SourcePreflightSeverity = 'error',
): SourcePreflightIssue {
	return { code, file, line, message, severity };
}

export function stripEnvironmentBlocks(
	content: string,
	envNames: string[],
): string {
	let result = content;
	for (const envName of envNames) {
		const pattern = new RegExp(
			String.raw`\\begin\{${escapeRegExp(envName)}\}[\s\S]*?\\end\{${escapeRegExp(envName)}\}`,
			'g',
		);
		result = result.replace(pattern, match =>
			'\n'.repeat(match.split('\n').length - 1),
		);
	}
	return result;
}

export function splitMarkdownTableRow(line: string): string[] {
	const trimmed = line.trim();
	const cells: string[] = [];
	let start = 0;
	let backslashes = 0;
	for (let index = 0; index < trimmed.length; index++) {
		const character = trimmed[index];
		if (character === '|' && backslashes % 2 === 0) {
			cells.push(trimmed.slice(start, index).trim());
			start = index + 1;
		}
		backslashes = character === '\\' ? backslashes + 1 : 0;
	}
	cells.push(trimmed.slice(start).trim());
	if (trimmed.startsWith('|')) cells.shift();
	if (start === trimmed.length && trimmed.endsWith('|')) cells.pop();
	return cells;
}

export function isMarkdownTableSeparator(line: string): boolean {
	const cells = splitMarkdownTableRow(line);
	return (
		line.includes('|') &&
		cells.length > 0 &&
		cells.every(cell => /^:?-+:?$/.test(cell))
	);
}
