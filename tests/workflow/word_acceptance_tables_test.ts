import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { verifyAcceptedDocxIntegrity } from '@/app/word-acceptance-integrity';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-accept-tables-'));
const source = path.join(temporary, 'source.docx');
const accepted = path.join(temporary, 'accepted.docx');
const manifestPath = path.join(temporary, 'acceptance.json');
const p = (text: string, alignment: string) =>
	`<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (text: string, alignment: string) =>
	`<w:tc>${p(text, alignment)}</w:tc>`;
function write(target: string, heading = 'center', span = '', repeat = '') {
	const archive = new AdmZip();
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc('Модель', heading)}${tc('Метрика', 'center')}</w:tr><w:tr><w:trPr>${repeat}</w:trPr><w:tc><w:tcPr>${span}</w:tcPr>${p('GRU', 'left')}</w:tc>${tc('0,123', 'right')}</w:tr></w:tbl></w:body></w:document>`,
		),
	);
	archive.addFile(
		'word/styles.xml',
		Buffer.from(`<w:styles xmlns:w="${W}"/>`),
	);
	archive.writeZip(target);
}
try {
	write(source);
	write(accepted);
	const manifest: Record<string, unknown> = {};
	verifyAcceptedDocxIntegrity(source, accepted, manifestPath, manifest);
	assert.deepEqual(
		(manifest.tableChecks as { check: string }[]).map(
			result => result.check,
		),
		[
			'Table Header Horizontal Alignment',
			'Table Grid Structure',
			'Table Header Repeat Order',
			'Table Caption Direct Formatting',
		],
	);
	assert.ok(
		(manifest.tableChecks as { passed: boolean }[]).every(
			check => check.passed,
		),
	);
	for (const [heading, span, repeat, check] of [
		['left', '', '', 'Table Header Horizontal Alignment'],
		['right', '', '', 'Table Header Horizontal Alignment'],
		['center', '<w:gridSpan w:val="2"/>', '', 'Table Grid Structure'],
		['center', '', '<w:tblHeader/>', 'Table Header Horizontal Alignment'],
	]) {
		write(accepted, heading, span, repeat);
		const rejected: Record<string, unknown> = {};
		assert.throws(
			() =>
				verifyAcceptedDocxIntegrity(
					source,
					accepted,
					manifestPath,
					rejected,
				),
			new RegExp(check),
		);
		assert.equal(rejected.status, 'failed');
		assert.equal(
			JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status,
			'failed',
		);
	}
	console.log(
		'Word acceptance table gate: valid right-aligned data accepted; 4 corruptions rejected with failed manifests.',
	);
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
}
