import { STO_RULES } from '@/shared/config';

import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function validateStoEnvironments(
	file: string,
	content: string,
	issues: SourcePreflightIssue[],
): void {
	const supported = new Set(STO_RULES.markdown.supportedEnvironments);
	const stack: { envName: string; line: number }[] = [];
	const tokenMatches = [...content.matchAll(/\\(begin|end)\{([^}]+)\}/g)];

	for (const match of tokenMatches) {
		const command = match[1];
		const envName = match[2];
		const line = lineNumberAt(content, match.index ?? 0);

		if (!supported.has(envName)) {
			issues.push(
				issue(
					'unsupported-sto-environment',
					`unsupported STO environment "${envName}". Supported: ${STO_RULES.markdown.supportedEnvironments.join(', ')}.`,
					file,
					line,
				),
			);
			continue;
		}

		if (command === 'begin') {
			stack.push({ envName, line });
			continue;
		}

		const opening = stack.pop();
		if (!opening) {
			issues.push(
				issue(
					'unmatched-sto-environment-close',
					`closing \\end{${envName}} has no matching \\begin{${envName}}.`,
					file,
					line,
				),
			);
			continue;
		}

		if (opening.envName !== envName) {
			issues.push(
				issue(
					'mismatched-sto-environment',
					`closes \\begin{${opening.envName}} from L${opening.line} with \\end{${envName}}.`,
					file,
					line,
				),
			);
		}
	}

	for (const opening of stack) {
		issues.push(
			issue(
				'unclosed-sto-environment',
				`\\begin{${opening.envName}} has no matching \\end{${opening.envName}}.`,
				file,
				opening.line,
			),
		);
	}
}
