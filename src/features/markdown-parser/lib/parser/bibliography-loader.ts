import fs from 'node:fs';
import path from 'node:path';
import * as bibtexParse from '@orcid/bibtex-parse-js';

import { BibItem } from '../types';

export function loadBibliography(
	metadata: Record<string, unknown>,
	cwd: string = process.cwd(),
): BibItem[] {
	if (!metadata.bibliography) {
		return [];
	}

	const bibPath = path.resolve(cwd, String(metadata.bibliography));
	if (!fs.existsSync(bibPath)) {
		console.warn(`Bibliography file not found: ${bibPath}`);
		return [];
	}

	const bibContent = fs.readFileSync(bibPath, 'utf-8');
	return bibtexParse.toJSON(bibContent) as BibItem[];
}
