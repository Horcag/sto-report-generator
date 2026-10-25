import { resolveBibliographyPath } from '@/shared/lib/bibliography-path';
import { parseCitationReferences } from '@/shared/lib/citation-syntax';
import { parseReportFrontmatter as matter } from '@/shared/lib/frontmatter';

import { maskCitationLiterals } from './text-context';
import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

function collectCitationKeys(
	content: string,
	onInvalid?: (message: string, line: number) => void,
): string[] {
	const keys = new Set<string>();
	for (const match of maskCitationLiterals(content).matchAll(
		/\[@([^\]]*)]/g,
	)) {
		try {
			for (const { key } of parseCitationReferences(match[1])) {
				keys.add(key);
			}
		} catch (error) {
			onInvalid?.(String(error), lineNumberAt(content, match.index ?? 0));
		}
	}
	return [...keys];
}

export function collectAllCitationKeys(
	files: SourceFile[],
	issues?: SourcePreflightIssue[],
): string[] {
	return [
		...new Set(
			files.flatMap(({ file, content }) =>
				collectCitationKeys(content, (message, line) => {
					issues?.push(
						issue('citation-invalid-syntax', message, file, line),
					);
				}),
			),
		),
	];
}

export function readBibliographyMetadata(
	files: SourceFile[],
): Record<string, unknown> {
	for (const source of files) {
		const parsed = matter(source.content);
		if (Object.keys(parsed.data).length > 0) {
			return parsed.data as Record<string, unknown>;
		}
	}
	return {};
}

export function bibliographyPathFromMetadata(
	files: SourceFile[],
	sourceDir: string,
	cwd: string,
): string {
	const metadata = readBibliographyMetadata(files);
	const rawPath =
		typeof metadata.bibliography === 'string'
			? metadata.bibliography
			: 'references.bib';
	return resolveBibliographyPath(rawPath, sourceDir, cwd);
}
