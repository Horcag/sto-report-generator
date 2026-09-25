import { parseStoInlineListItems } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function validateInlineLists(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(
		/\\sto_inline_list\{([^}]*)\}\{([^}]*)\}/g,
	)) {
		const line = lineNumberAt(content, match.index ?? 0);
		const kind = match[1];
		const items = parseStoInlineListItems(match[2]);
		if (kind !== 'simple' && kind !== 'complex') {
			issues.push(
				issue(
					'inline-list-kind-invalid',
					'inline list kind must be simple or complex.',
					file,
					line,
				),
			);
			continue;
		}
		if (!items) {
			issues.push(
				issue(
					'inline-list-items-invalid',
					'inline list requires at least two nonempty items without trailing punctuation.',
					file,
					line,
				),
			);
			continue;
		}
		if (kind === 'simple' && items.some(item => /[,;]/.test(item))) {
			issues.push(
				issue(
					'inline-list-simple-complex-item',
					'simple inline list items must not contain commas or semicolons; choose complex for compound items.',
					file,
					line,
				),
			);
		}
	}
}
