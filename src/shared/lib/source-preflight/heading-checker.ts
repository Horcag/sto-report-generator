import { SourcePreflightIssue } from './types';
import { issue } from './utils';

export function validateMarkdownHeadings(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	let previousDepth: number | null = null;
	const lines = content.split('\n');

	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{1,6})\s*(.*?)\s*$/.exec(lines[index]);
		if (!match) {
			continue;
		}

		const depth = match[1].length;
		const text = match[2].trim();
		const textWithoutNumber = text
			.replace(/^\d+(?:\.\d+)*\.?\s*/, '')
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
}
