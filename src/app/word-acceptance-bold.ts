import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { unpackDocx } from '@/shared/lib/docx-archive';
import { validateSTO } from '@/shared/lib/sto-validator';

export function assertNoOrdinaryBodyBold(docxPath: string): void {
	const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bold-check-'));
	try {
		unpackDocx(docxPath, unpackDir);
		const check = validateSTO(unpackDir).find(
			result => result.check === 'Ordinary Body Bold Text',
		);
		if (!check || !check.passed) {
			throw new Error(
				`Word acceptance rejected ${docxPath}: ${check?.error ?? 'ordinary body bold check was unavailable'}`,
			);
		}
	} finally {
		fs.rmSync(unpackDir, { recursive: true, force: true });
	}
}
