import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { createWordAcceptancePlan } from '@/app/word-acceptance';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-word-plan-'));
try {
	const inputDocx = path.join(directory, 'strict.docx');
	const archive = new AdmZip();
	archive.addFile(
		'docProps/custom.xml',
		Buffer.from(
			'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="STOStylePreset"><vt:lpwstr>sto-strict</vt:lpwstr></property></Properties>',
		),
	);
	archive.writeZip(inputDocx);
	const environment = {
		hostKind: 'windows' as const,
		toHostPath: (value: string) => value,
	};
	const plan = createWordAcceptancePlan({ inputDocx }, environment);
	assert.equal(plan.request.stylePreset, 'sto-strict');
	assert.ok(plan.request.expectedStyles.length > 0);
	assert.throws(
		() =>
			createWordAcceptancePlan(
				{ inputDocx, stylePreset: 'default' },
				environment,
			),
		/conflicting/,
	);
	const ordinaryDocx = path.join(directory, 'ordinary.docx');
	const ordinary = new AdmZip();
	ordinary.addFile('word/document.xml', Buffer.from('<document/>'));
	ordinary.writeZip(ordinaryDocx);
	assert.throws(
		() =>
			createWordAcceptancePlan(
				{ inputDocx: ordinaryDocx, stylePreset: 'sto-strict' },
				environment,
			),
		/marked/,
	);
	assert.equal(
		createWordAcceptancePlan({ inputDocx: ordinaryDocx }, environment)
			.request.stylePreset,
		'samara-template-2022',
	);
	console.log('Strict Word acceptance planning: 5 assertions passed.');
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
}
