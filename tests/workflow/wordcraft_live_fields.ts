import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { prepareWordcraftTocForImport } from '@/app/wordcraft-fields';

const DOCUMENT_XML = 'word/document.xml';

function readXml(docx: string): string {
	const entry = new AdmZip(docx).getEntry(DOCUMENT_XML);
	assert.ok(entry, `${DOCUMENT_XML} exists in ${path.basename(docx)}`);
	return entry.getData().toString('utf8');
}

export function wordcraftFieldSpan(xml: string, instruction: string): string {
	const marker = xml.indexOf(instruction);
	assert.notEqual(marker, -1, `field instruction exists: ${instruction}`);
	const stack: number[] = [];
	let fieldStart: number | undefined;
	for (const match of xml.matchAll(/<w:fldChar\b[^>]*>/g)) {
		if (match.index > marker && fieldStart === undefined) {
			fieldStart = stack.at(-1);
			assert.notEqual(
				fieldStart,
				undefined,
				'instruction belongs to an open field',
			);
		}
		const type = /\bw:fldCharType="([^"]+)"/.exec(match[0])?.[1];
		if (type === 'begin') stack.push(match.index);
		if (type === 'end') {
			const start = stack.pop();
			if (fieldStart !== undefined && start === fieldStart) {
				return xml.slice(fieldStart, match.index);
			}
		}
	}
	assert.fail('field boundaries are complete');
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
		assert.equal(
			prepareWordcraftTocForImport(stale),
			1,
			'only the staged semantic TOC wrapper is prepared for engine import',
		);

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
		const outputToc = wordcraftFieldSpan(output, 'TOC \\f');
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
