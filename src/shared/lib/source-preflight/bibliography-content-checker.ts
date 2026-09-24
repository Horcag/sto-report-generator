import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function validateManualBibliographyContent(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	for (const match of content.matchAll(
		/\\begin\{sto_bibliography\}\s*([\s\S]*?)\s*\\end\{sto_bibliography\}/g,
	)) {
		const manualContent = match[1].trim();
		if (manualContent.length > 0) {
			issues.push(
				issue(
					'manual-bibliography-content',
					'sto_bibliography must stay empty. The generator inserts only cited sources automatically.',
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}
}
