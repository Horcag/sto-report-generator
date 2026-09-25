import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadBibliography } from '@/features/markdown-parser/lib/parser/bibliography-loader';

export function testBibliographyPathResolution(): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-path-'));
	try {
		const sourceDir = path.join(tempDir, 'source');
		const cwd = path.join(tempDir, 'cwd');
		fs.mkdirSync(sourceDir);
		fs.mkdirSync(cwd);
		const metadata = { bibliography: 'references.bib' };
		assert.throws(
			() => loadBibliography(metadata, sourceDir, cwd),
			/Bibliography file not found/,
		);
		fs.writeFileSync(
			path.join(sourceDir, 'references.bib'),
			'@book{source, title = {Source copy}}',
		);
		assert.equal(
			loadBibliography(metadata, sourceDir, cwd)[0]?.citationKey,
			'source',
		);
		fs.writeFileSync(
			path.join(cwd, 'references.bib'),
			'@book{cwd, title = {CWD copy}}',
		);
		assert.throws(
			() => loadBibliography(metadata, sourceDir, cwd),
			/ambiguous/i,
		);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}
