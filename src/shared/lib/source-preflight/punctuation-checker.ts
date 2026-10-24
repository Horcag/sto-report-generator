import { STO_RULES } from '@/shared/config';

import { maskSourceCodeFences } from './text-context';
import { SourcePreflightIssue } from './types';
import { escapeRegExp, isMarkdownTableSeparator, issue } from './utils';

export function validateSourcePunctuation(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const lines = maskSourceCodeFences(content).split('\n');
	const prefixes = [
		STO_RULES.validation.figureCaptionPrefix,
		STO_RULES.validation.tableCaptionPrefix,
	]
		.map(escapeRegExp)
		.join('|');
	const captionPattern = new RegExp(
		`^(${prefixes})\\s+(?:@(?:fig|tab):[a-zA-Z0-9_-]+|[А-ЯЁ]\\.\\d+|\\d+(?:\\.\\d+)?)(?![a-zA-ZА-Яа-яЁё0-9_]|\\.\\d)(.*)$`,
	);

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const line = i + 1;
		const caption = captionPattern.exec(trimmed);
		if (!caption) continue;
		const title = caption[2]
			.replace(/\s*\(@(?:fig|tab):[a-zA-Z0-9_-]+\)\s*$/, '')
			.trim();
		let adjacentObject: boolean;
		if (caption[1] === STO_RULES.validation.tableCaptionPrefix) {
			let next = i + 1;
			while (next < lines.length && !lines[next].trim()) next++;
			adjacentObject =
				next + 1 < lines.length &&
				Boolean(lines[next].trim()) &&
				isMarkdownTableSeparator(lines[next + 1]);
		} else {
			let previous = i - 1;
			while (previous >= 0 && !lines[previous].trim()) previous--;
			adjacentObject =
				previous >= 0 &&
				/^!\[[^\]]*\]\([^)]+\)/.test(lines[previous].trim());
		}
		// Bare object references also start prose sentences. Diagnose a title
		// only when a label, dash attempt or adjacent object establishes a caption.
		if (
			!adjacentObject &&
			!/@(?:fig|tab):/.test(trimmed) &&
			!/^[-–—]/.test(title)
		)
			continue;

		if (title.endsWith('.')) {
			issues.push(
				issue(
					'caption-final-period',
					'table and figure captions must not end with a final dot.',
					file,
					line,
				),
			);
		}

		if (title && !/^\s+–(?:\s|$)/.test(caption[2])) {
			issues.push(
				issue(
					'caption-missing-en-dash-separator',
					'table and figure captions must use " – " between number and caption text.',
					file,
					line,
				),
			);
		}
	}
}
