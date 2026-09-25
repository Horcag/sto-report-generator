import fs from 'node:fs';
import * as bibtexParse from '@orcid/bibtex-parse-js';

import { resolveBibliographyPath } from '@/shared/lib/bibliography-path';

import { BibItem } from '../types';

export function loadBibliography(
	metadata: Record<string, unknown>,
	sourceDir: string = process.cwd(),
	cwd: string = process.cwd(),
): BibItem[] {
	if (!metadata.bibliography) {
		return [];
	}

	const bibPath = resolveBibliographyPath(
		String(metadata.bibliography),
		sourceDir,
		cwd,
	);
	if (!fs.existsSync(bibPath)) {
		throw new Error(`Bibliography file not found: ${bibPath}`);
	}

	const bibContent = fs.readFileSync(bibPath, 'utf-8');
	return bibtexParse.toJSON(bibContent) as BibItem[];
}
