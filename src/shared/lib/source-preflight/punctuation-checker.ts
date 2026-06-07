import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { issue } from './utils';

export function validateSourcePunctuation(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const lines = content.split('\n');
	const captionPattern = new RegExp(
		`^(?:${STO_RULES.validation.figureCaptionPrefix}|${STO_RULES.validation.tableCaptionPrefix})\\s+\\d+\\s+–\\s+`,
	);
	const captionWithFinalDotPattern = new RegExp(
		`^(?:${STO_RULES.validation.figureCaptionPrefix}|${STO_RULES.validation.tableCaptionPrefix})\\s+\\d+\\s+–\\s+[\\s\\S]*\\.\\s*(?:\\(@(?:fig|tab):[a-zA-Z0-9_-]+\\))?$`,
	);

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const line = i + 1;

		if (/^где\s*:/.test(trimmed)) {
			issues.push(
				issue(
					'where-colon',
					'uses "где:". STO formula explanations start with "где" without a colon.',
					file,
					line,
				),
			);
		}

		if (captionWithFinalDotPattern.test(trimmed)) {
			issues.push(
				issue(
					'caption-final-period',
					'table and figure captions must not end with a final dot.',
					file,
					line,
				),
			);
		}

		if (captionPattern.test(trimmed) && !/\s–\s/.test(trimmed)) {
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
