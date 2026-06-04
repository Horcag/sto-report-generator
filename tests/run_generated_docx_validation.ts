import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '../src/app/builder';
import { unpackDocx } from '../src/shared/lib/docx-archive';
import { validateSTO } from '../src/shared/lib/sto-validator';

const tempRoot = path.join(process.cwd(), '.agent-work', 'generated-docx');
const outputDocx = path.join(tempRoot, 'example.docx');
const unpackedDir = path.join(tempRoot, 'unpacked');

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });

	await buildReport('example', outputDocx);
	unpackDocx(outputDocx, unpackedDir);

	const failed = validateSTO(unpackedDir).filter(result => !result.passed);
	assert.deepEqual(
		failed.map(result => `${result.check}: ${result.error ?? 'failed'}`),
		[],
	);

	console.log('Generated DOCX validation test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
