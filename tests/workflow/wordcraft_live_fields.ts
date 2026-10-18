import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const DOCUMENT_XML = 'word/document.xml';

function readXml(docx: string): string {
	const entry = new AdmZip(docx).getEntry(DOCUMENT_XML);
	assert.ok(entry, `${DOCUMENT_XML} exists in ${path.basename(docx)}`);
	return entry.getData().toString('utf8');
}

function fieldSpan(xml: string, instruction: string): string {
	const marker = xml.indexOf(instruction);
	assert.notEqual(marker, -1, `field instruction exists: ${instruction}`);
	const fieldStart = xml.lastIndexOf('<w:fldChar', marker);
	const fieldEnd = xml.indexOf('<w:fldChar w:fldCharType="end"', marker);
	assert.ok(
		fieldStart >= 0 && fieldStart < marker && fieldEnd > marker,
		'field boundaries are complete',
	);
	return xml.slice(fieldStart, fieldEnd);
}

/** Runs the installed Wordcraft field updater against a disposable DOCX copy. */
export function verifyLiveWordcraftFields(
	inputDocx: string,
	directory: string,
): void {
	assert.ok(fs.existsSync(inputDocx), `input DOCX exists: ${inputDocx}`);
	const executable = process.env.WORDCRAFT_CLI ?? 'wordcraft-cli';
	fs.mkdirSync(directory, { recursive: true });
	const sourceHash = fs.readFileSync(inputDocx);
	const stale = path.join(directory, 'wordcraft-fields-stale.docx');
	const updated = path.join(directory, 'wordcraft-fields-updated.docx');
	try {
		const archive = new AdmZip(inputDocx);
		const entry = archive.getEntry(DOCUMENT_XML);
		assert.ok(entry, `${DOCUMENT_XML} exists in input`);
		let xml = entry.getData().toString('utf8');
		const tocMarker = xml.indexOf('TOC \\f');
		const tocEnd = xml.indexOf('</w:p>', tocMarker);
		const tocParagraphStart = Math.max(
			xml.lastIndexOf('<w:p>', tocMarker),
			xml.lastIndexOf('<w:p ', tocMarker),
		);
		assert.ok(
			tocParagraphStart >= 0 && tocEnd > tocParagraphStart,
			'TOC paragraph is complete',
		);
		const tocParagraph = xml.slice(
			tocParagraphStart,
			tocEnd + '</w:p>'.length,
		);
		const staleParagraph = tocParagraph.replace(
			/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/,
			'<w:r><w:t>STALE WORDCRAFT TOC PLACEHOLDER</w:t></w:r>',
		);
		assert.notEqual(
			staleParagraph,
			tocParagraph,
			'TOC field has a cached hyperlink result to replace',
		);
		xml = xml.replace(tocParagraph, staleParagraph);
		const paragraphBegin = Math.max(
			xml.lastIndexOf('<w:p>', tocMarker),
			xml.lastIndexOf('<w:p ', tocMarker),
		);
		const begin = xml.indexOf(
			'<w:fldChar w:fldCharType="begin"',
			paragraphBegin,
		);
		assert.ok(
			begin >= 0 && begin < tocMarker,
			'outer TOC field begins before its instruction',
		);
		const beginTagEnd = xml.indexOf('/>', begin);
		assert.ok(beginTagEnd > begin, 'outer TOC begin field tag is complete');
		assert.doesNotMatch(
			xml.slice(begin, beginTagEnd),
			/\bw:dirty=/,
			'outer TOC is initially clean',
		);
		xml =
			xml.slice(0, beginTagEnd) +
			' w:dirty="true"' +
			xml.slice(beginTagEnd);
		assert.equal(
			(xml.match(/w:dirty="true"/g) ?? []).length,
			1,
			'only outer TOC begin is marked dirty',
		);
		archive.updateFile(DOCUMENT_XML, Buffer.from(xml, 'utf8'));
		archive.writeZip(stale);

		const result = spawnSync(
			executable,
			[
				'run',
				'--file',
				stale,
				'--cmd',
				'references.updateFields',
				'--save',
				updated,
			],
			{ encoding: 'utf8', shell: false, timeout: 120_000 },
		);
		if (result.error) throw result.error;
		assert.equal(
			result.status,
			0,
			`Wordcraft updateFields failed: ${result.stderr}`,
		);
		assert.ok(fs.existsSync(updated), 'Wordcraft saved the updated DOCX');
		const output = readXml(updated);
		const outputToc = fieldSpan(output, 'TOC \\f');
		assert.doesNotMatch(output, /STALE WORDCRAFT TOC PLACEHOLDER/);
		assert.doesNotMatch(
			outputToc.slice(0, outputToc.indexOf('TOC \\f')),
			/w:dirty="true"/,
			'updated TOC dirty flag is cleared',
		);
		assert.match(outputToc, /Введение/);
		assert.match(outputToc, /Математические формулы/);
		assert.ok(
			outputToc.includes('1.1 Математические формулы'),
			'numbered heading is present after updating the TOC',
		);
		assert.deepEqual(
			fs.readFileSync(inputDocx),
			sourceHash,
			'source DOCX remains unchanged',
		);
	} finally {
		fs.rmSync(stale, { force: true });
		fs.rmSync(updated, { force: true });
	}
}
