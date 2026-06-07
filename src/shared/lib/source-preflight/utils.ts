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

export function stripMarkdownNoise(content: string): string {
	return content
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, match =>
			'\n'.repeat(match.split('\n').length - 1),
		)
		.replace(/```[\s\S]*?```/g, match =>
			'\n'.repeat(match.split('\n').length - 1),
		)
		.replace(/\$\$[\s\S]*?\$\$/g, match =>
			'\n'.repeat(match.split('\n').length - 1),
		)
		.replace(/\$[^$\n]+\$/g, '')
		.replace(/`[^`\n]+`/g, '')
		.replace(/!\[[^\]]*]\([^)]+\)/g, '')
		.replace(/^\|.*$/gm, '');
}

export function splitMarkdownTableRow(line: string): string[] {
	const trimmed = line.trim();
	const withoutOuter = trimmed.replace(/^\|/, '').replace(/\|$/, '');
	return withoutOuter.split('|').map(cell => cell.trim());
}

export function isMarkdownTableSeparator(line: string): boolean {
	return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
