import { maskCitationLiterals } from './text-context';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function validateCitationContext(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
): void {
	for (const { file, content } of files) {
		const prose = maskCitationLiterals(content);
		for (const match of prose.matchAll(
			/\[(?:\d+(?:\s*[-–,]\s*\d+)*)(?:,\s*[сp]\.\s*\d+(?:[-–]\d+)?)?\]/g,
		)) {
			if (
				(match[0].match(/\d+/g) ?? []).some(
					value => Number(value) === 0,
				)
			)
				continue;
			issues.push(
				issue(
					'bibliography-manual-citation-number',
					'Possible source number typed manually. Use [@key] so numbering and the source list stay synchronized; verify literal numeric intervals separately.',
					file,
					lineNumberAt(content, match.index!),
					'warning',
				),
			);
		}
		for (const match of prose.matchAll(/[.!?]\s+\[@[^\]]+\]/g)) {
			const before = prose.slice(0, match.index! + 1);
			if (
				/(?:\b(?:al|e\.g|i\.e|p|pp)|(?:т\.\s*[дп]|др|рис|табл|гг?|см|напр|с))\.$/iu.test(
					before,
				)
			)
				continue;
			issues.push(
				issue(
					'bibliography-citation-after-punctuation',
					'The source citation may be detached from its sentence. Place the sentence-ending period after [@key]; check abbreviations and quoted punctuation against the original.',
					file,
					lineNumberAt(content, match.index!),
					'warning',
				),
			);
		}
	}
}
