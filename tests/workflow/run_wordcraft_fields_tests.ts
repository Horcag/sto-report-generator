import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { prepareWordcraftTocForImport } from '@/app/wordcraft-fields';

import { wordcraftFieldSpan } from './wordcraft_live_fields';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const field =
	'<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/><w:instrText>TOC \\f "A"</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:hyperlink w:anchor="_Toc1"><w:r><w:t>1.1 CONTROL HEADING</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGEREF _Toc1</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>4</w:t><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink><w:r><w:t>AFTER NESTED FIELD</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const wrap = (content: string, gallery = 'Table of Contents'): string =>
	`<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="${gallery}"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const documentXml = (body: string): string =>
	`<w:document xmlns:w="${word}"><w:body>${body}</w:body></w:document>`;
const parse = (xml: string): Document =>
	new JSDOM(xml, { contentType: 'text/xml' }).window.document;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-fields-test-'));
const docx = path.join(directory, 'staged.docx');

function fixture(body: string): void {
	const archive = new AdmZip();
	archive.addFile('word/document.xml', Buffer.from(documentXml(body)));
	archive.addFile('word/styles.xml', Buffer.from('UNCHANGED STYLES'));
	archive.addFile('word/media/control.bin', Buffer.from([1, 2, 3, 4]));
	archive.writeZip(docx);
}

try {
	assert.match(wordcraftFieldSpan(field, 'TOC \\f'), /PAGEREF _Toc1/);
	assert.match(
		wordcraftFieldSpan(field, 'TOC \\f'),
		/AFTER NESTED FIELD/,
		'outer result includes nested field result before matching outer end',
	);
	const earlyEnd =
		'<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\f "A"</w:instrText><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r><w:p><w:r><w:t>OUTSIDE TOC RESULT</w:t></w:r></w:p>';
	assert.doesNotMatch(
		wordcraftFieldSpan(earlyEnd, 'TOC \\f'),
		/OUTSIDE TOC RESULT/,
		'raw 0.10 early-end shape does not count following sibling text as field result',
	);
	console.log(
		'PASS strict field-depth discovery keeps nested results and rejects raw early-end sibling cache',
	);
	fixture(
		`<w:p><w:r><w:t>BEFORE</w:t></w:r></w:p>${wrap(field)}<w:p><w:r><w:t>AFTER</w:t></w:r></w:p>`,
	);
	const expected = parse(
		documentXml(
			`<w:p><w:r><w:t>BEFORE</w:t></w:r></w:p>${field}<w:p><w:r><w:t>AFTER</w:t></w:r></w:p>`,
		),
	);
	assert.equal(prepareWordcraftTocForImport(docx), 1);
	const archive = new AdmZip(docx);
	const output = parse(archive.readAsText('word/document.xml'));
	assert.equal(
		output.documentElement.outerHTML,
		expected.documentElement.outerHTML,
		'only the semantic wrapper changes; complete nested fields, dirty flag, text and siblings stay intact',
	);
	assert.equal(archive.readAsText('word/styles.xml'), 'UNCHANGED STYLES');
	assert.deepEqual(
		archive.readFile('word/media/control.bin'),
		Buffer.from([1, 2, 3, 4]),
	);
	console.log(
		'PASS semantic TOC import preparation preserves complete field, nested PAGEREF, dirty flag, siblings and unrelated ZIP entries',
	);
	const prepared = fs.readFileSync(docx);
	assert.equal(prepareWordcraftTocForImport(docx), 0);
	assert.deepEqual(fs.readFileSync(docx), prepared);
	console.log('PASS repeated preparation leaves DOCX bytes unchanged');

	for (const [label, body] of [
		['unwrapped TOC', field],
		['foreign gallery', wrap(field, 'Bibliographies')],
		[
			'missing TOC instruction',
			wrap('<w:p><w:r><w:t>UNRELATED</w:t></w:r></w:p>'),
		],
		['nested content control', wrap(wrap(field))],
	]) {
		fixture(body);
		const before = fs.readFileSync(docx);
		const count = prepareWordcraftTocForImport(docx);
		if (label === 'nested content control') {
			assert.equal(
				count,
				1,
				'only the proven inner semantic TOC is prepared',
			);
			assert.equal(
				parse(
					new AdmZip(docx).readAsText('word/document.xml'),
				).getElementsByTagNameNS(word, 'sdt').length,
				1,
				'outer content control remains intact',
			);
		} else {
			assert.equal(count, 0);
			assert.deepEqual(fs.readFileSync(docx), before);
		}
		console.log(`PASS guard: ${label}`);
	}
} finally {
	fs.rmSync(directory, { recursive: true, force: true });
	assert.equal(fs.existsSync(directory), false);
}
