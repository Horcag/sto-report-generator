export interface SourceTextContext {
	prose: string;
	isSymbolicSign(index: number): boolean;
}

function maskRange(chars: string[], start: number, end: number): void {
	const safeStart = Math.max(0, start);
	const safeEnd = Math.min(chars.length, end);
	for (let index = safeStart; index < safeEnd; index += 1) {
		if (chars[index] !== '\n' && chars[index] !== '\r') {
			chars[index] = ' ';
		}
	}
}

function maskPattern(chars: string[], content: string, pattern: RegExp): void {
	for (const match of content.matchAll(pattern)) {
		maskRange(
			chars,
			match.index ?? 0,
			(match.index ?? 0) + match[0].length,
		);
	}
}

function maskFrontmatter(chars: string[], content: string): void {
	const match = content.match(
		/^---[^\S\r\n]*(?:\r?\n)[\s\S]*?(?:\r?\n)---[^\S\r\n]*(?:\r?\n|$)/,
	);
	if (match?.index === 0) {
		maskRange(chars, 0, match[0].length);
	}
}

export function maskSourceFrontmatter(content: string): string {
	const chars = content.split('');
	maskFrontmatter(chars, content);
	return chars.join('');
}

export function maskSourceCodeFences(content: string): string {
	const source = maskSourceFrontmatter(content);
	const chars = source.split('');
	let fenceCharacter: '`' | '~' | undefined;
	let fenceLength = 0;
	let lineStart = 0;

	for (const line of source.split(/(?<=\n)/)) {
		const value = line.replace(/\r?\n$/, '');
		if (fenceCharacter) {
			const closing = /^( {0,3})(`+|~+)[ \t]*$/.exec(value);
			if (
				closing &&
				closing[2][0] === fenceCharacter &&
				closing[2].length >= fenceLength
			) {
				fenceCharacter = undefined;
				fenceLength = 0;
			}
			maskRange(chars, lineStart, lineStart + line.length);
		} else {
			const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(value);
			if (
				opening &&
				!(opening[2][0] === '`' && opening[3].includes('`'))
			) {
				fenceCharacter = opening[2][0] as '`' | '~';
				fenceLength = opening[2].length;
				maskRange(chars, lineStart, lineStart + line.length);
			}
		}
		lineStart += line.length;
	}

	return chars.join('');
}

function maskMarkdownLinkTargets(chars: string[], content: string): void {
	for (const match of content.matchAll(/\[[^\]\r\n]+]\(([^)\r\n]+)\)/g)) {
		const index = match.index ?? 0;
		const targetStartInMatch = match[0].lastIndexOf('](') + 2;
		const targetEndInMatch = match[0].length - 1;
		maskRange(chars, index + targetStartInMatch, index + targetEndInMatch);
	}
}

function maskHeadingNumberPrefixes(chars: string[], content: string): void {
	for (const match of content.matchAll(
		/^(\s*#{1,6}\s+)(\d+(?:\.\d+)*\.?\s+)/gm,
	)) {
		maskRange(
			chars,
			match.index ?? 0,
			(match.index ?? 0) + match[1].length + match[2].length,
		);
	}
}

function maskStructuralReferenceNumbers(
	chars: string[],
	content: string,
): void {
	const structuralReferencePattern =
		/((?:раздел[а-яё]*|подраздел[а-яё]*|пункт[а-яё]*|подпункт[а-яё]*|глав[а-яё]*|рисунк[а-яё]*|таблиц[а-яё]*|формул[а-яё]*|приложени[а-яё]*|ГОСТ|СТО)\s+)(\d+(?:\.\d+)+\.?)/giu;
	for (const match of content.matchAll(structuralReferencePattern)) {
		const index = match.index ?? 0;
		maskRange(chars, index + match[1].length, index + match[0].length);
	}
}

function findSymbolicSignIndexes(prose: string): Set<number> {
	const indexes = new Set<number>();
	for (const match of prose.matchAll(/(?:<=|>=|[=≈≠≤≥<>])\s*([-+])(?=\d)/g)) {
		indexes.add((match.index ?? 0) + match[0].lastIndexOf(match[1]));
	}
	return indexes;
}

export function maskCitationLiterals(content: string): string {
	const chars = maskSourceCodeFences(content).split('');
	maskPattern(chars, content, /\$\$[\s\S]*?\$\$/g);
	maskPattern(chars, content, /`[^`\r\n]+`/g);
	maskPattern(chars, content, /(?<!\$)\$[^$\r\n]+\$(?!\$)/g);
	maskPattern(chars, content, /!\[[^\]\r\n]*]\([^)\r\n]+\)/g);
	maskMarkdownLinkTargets(chars, content);
	maskPattern(chars, content, /<!--[\s\S]*?-->/g);
	return chars.join('');
}

export function createSourceTextContext(content: string): SourceTextContext {
	const chars = maskCitationLiterals(content).split('');
	maskPattern(chars, content, /<br\s*\/?>/gi);
	maskPattern(chars, content, /^\s*\|.*$/gm);
	maskPattern(chars, content, /\b(?:https?:\/\/|www\.)[^\s<>)]+/gi);
	maskPattern(chars, content, /\bv\d+(?:\.\d+)+\b/gi);
	maskPattern(chars, content, /\b\d+(?:\.\d+){2,}\b/g);
	maskPattern(chars, content, /\b10\.\d{4,9}\/[^\s<>)]+/g);
	maskHeadingNumberPrefixes(chars, content);
	maskStructuralReferenceNumbers(chars, content);

	const prose = chars.join('');
	const symbolicSignIndexes = findSymbolicSignIndexes(prose);

	return {
		prose,
		isSymbolicSign(index: number): boolean {
			return symbolicSignIndexes.has(index);
		},
	};
}
