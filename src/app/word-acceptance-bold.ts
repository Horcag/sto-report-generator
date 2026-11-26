import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isStrictStoDocx, unpackDocx } from '@/shared/lib/docx';
import { validateSTO } from '@/shared/lib/sto-validator';

export function assertNoOrdinaryBodyBold(docxPath: string): void {
	const unpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bold-check-'));
	try {
		unpackDocx(docxPath, unpackDir);
		const results = validateSTO(unpackDir);
		if (isStrictStoDocx(docxPath)) {
			const strictChecks = results.filter(result =>
				result.check.startsWith('Strict STO '),
			);
			if (strictChecks.length < 6) {
				throw new Error(
					`Word acceptance rejected ${docxPath}: strict STO typography checks were unavailable`,
				);
			}
			const failures = strictChecks.filter(result => !result.passed);
			if (failures.length) {
				throw new Error(
					`Word acceptance rejected strict DOCX ${docxPath}: ${failures.map(result => `${result.check}: ${result.error}`).join('; ')}`,
				);
			}
			return;
		}
		const check = results.find(
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
