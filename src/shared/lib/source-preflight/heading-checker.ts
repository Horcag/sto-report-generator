import { createSourceTextContext } from './text-context';
import { SourcePreflightIssue } from './types';
import { issue } from './utils';

const EXPLICIT_UNDERLINE =
	/<\s*(?:u|ins)(?:\s|>)|<\s*span\b[^>]*\btext-decoration\s*:\s*underline\b|\\underline\s*\{/iu;

function checkHeadingText(
	file: string,
	line: number,
	text: string,
	issues: SourcePreflightIssue[],
	structural: boolean,
	underlineSource = text,
): void {
	if (EXPLICIT_UNDERLINE.test(underlineSource)) {
		issues.push(
			issue(
				structural
					? 'structural-heading-underline'
					: 'markdown-heading-underline',
				'headings must not request underlining.',
				file,
				line,
			),
		);
	}

	if (structural) return;

	// A heading number is generated separately; only the title's first letter matters.
	const withoutNumber = text
		.replace(/^\d+(?:\.\d+)*\.?\s+/, '')
		.replace(/<[^>]*>/g, '')
		.trim();
	const firstLetter = withoutNumber.match(/\p{L}/u)?.[0];
	if (firstLetter && firstLetter !== firstLetter.toLocaleUpperCase('ru-RU')) {
		issues.push(
			issue(
				'markdown-heading-lowercase-start',
				'heading text must start with a capital letter.',
				file,
				line,
				'warning',
			),
		);
	}
}

export function validateMarkdownHeadings(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	let previousDepth: number | null = null;
	const lines = content.split('\n');
	const searchableLines = createSourceTextContext(content).prose.split('\n');

	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(lines[index]);
		if (!match) {
			continue;
		}
		if (!searchableLines[index].trim()) continue;

		const depth = match[1].length;
		const text = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
		const textWithoutNumber = text
			.replace(/^\d+(?:\.\d+)*\.?\s+/, '')
			.trim();

		if (textWithoutNumber.length === 0) {
			issues.push(
				issue(
					'markdown-heading-empty',
					'markdown heading must contain text after the number.',
					file,
					index + 1,
				),
			);
		}

		if (/[.]$/.test(textWithoutNumber)) {
			issues.push(
				issue(
					'markdown-heading-final-period',
					'markdown headings must not end with a final period.',
					file,
					index + 1,
					'warning',
				),
			);
		}

		checkHeadingText(
			file,
			index + 1,
			text,
			issues,
			false,
			searchableLines[index],
		);

		if (previousDepth !== null && depth > previousDepth + 1) {
			issues.push(
				issue(
					'markdown-heading-level-jump',
					`markdown heading level jumps from ${previousDepth} to ${depth}.`,
					file,
					index + 1,
					'warning',
				),
			);
		}

		previousDepth = depth;
	}

	for (let index = 0; index < searchableLines.length; index += 1) {
		const structural = /\\sto_structural_heading\{([^}]+)\}/g;
		for (const match of searchableLines[index].matchAll(structural)) {
			checkHeadingText(file, index + 1, match[1], issues, true);
		}
	}
}
