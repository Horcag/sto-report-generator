import fs from 'node:fs';
import path from 'node:path';

import { SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

export function validateImageExists(
	file: string,
	content: string,
	reportDir: string,
	cwd: string,
	issues: SourcePreflightIssue[],
): void {
	const imageMatches = [...content.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)];
	for (const match of imageMatches) {
		const imagePath = match[1].trim();
		if (/^(https?:|file:|#)/i.test(imagePath)) {
			continue;
		}

		const candidates = path.isAbsolute(imagePath)
			? [imagePath]
			: [
					path.resolve(reportDir, imagePath),
					path.resolve(cwd, imagePath),
				];
		if (!candidates.some(candidate => fs.existsSync(candidate))) {
			issues.push(
				issue(
					'missing-image',
					`image file does not exist: ${imagePath}`,
					file,
					lineNumberAt(content, match.index ?? 0),
				),
			);
		}
	}
}
