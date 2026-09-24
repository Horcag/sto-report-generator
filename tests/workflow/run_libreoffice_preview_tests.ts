import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLibreOfficePreview } from '@/app/libreoffice-preview';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-preview-test-'));
try {
	const inputDocx = path.join(directory, 'report.docx');
	fs.writeFileSync(inputDocx, 'fixture');
	assert.throws(
		() =>
			createLibreOfficePreview({
				inputDocx: path.join(directory, 'missing.docx'),
			}),
		/Expected an existing DOCX/,
	);

	if (process.platform !== 'win32') {
		const fakeSoffice = path.join(directory, 'fake-soffice');
		fs.writeFileSync(
			fakeSoffice,
			'#!/bin/sh\nfor last; do :; done\noutdir=""\nprev=""\nfor arg; do if [ "$prev" = "--outdir" ]; then outdir="$arg"; fi; prev="$arg"; done\nprintf "%%PDF-1.4\\nfixture" > "$outdir/$(basename "$last" .docx).pdf"\n',
		);
		fs.chmodSync(fakeSoffice, 0o755);
		const outputPdf = path.join(directory, 'export', 'preview.pdf');
		assert.equal(
			createLibreOfficePreview({
				inputDocx,
				outputPdf,
				soffice: fakeSoffice,
			}),
			outputPdf,
		);
		assert.equal(
			fs.readFileSync(outputPdf).subarray(0, 5).toString(),
			'%PDF-',
		);
		assert.throws(
			() =>
				createLibreOfficePreview({
					inputDocx,
					soffice: '/missing/soffice',
				}),
			/LibreOffice preview failed/,
		);
	}
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}

console.log('LibreOffice preview launcher tests passed.');
