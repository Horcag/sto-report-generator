import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import {
	createWordcraftPdf,
	readWordcraftVersion,
} from '@/app/wordcraft-renderer';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-wordcraft-test-'));
const oldMode = process.env.WORDCRAFT_TEST_MODE;
const oldExecutable = process.env.WORDCRAFT_CLI;
const inputDocx = path.join(directory, 'report.docx');
const fakeCli = path.join(directory, 'wordcraft-cli');
const log = path.join(directory, 'calls.jsonl');
const outputPdf = path.join(directory, 'report.wordcraft.pdf');
const manifestPath = path.join(directory, 'report.wordcraft.json');
let assertions = 0;

function check(condition: unknown, message?: string): void {
	assert.ok(condition, message ?? 'Expected condition to hold');
	assertions += 1;
}
function throws(action: () => unknown, pattern: RegExp): void {
	assert.throws(action, pattern);
	assertions += 1;
}
function cleanupCheck(): void {
	check(
		!fs
			.readdirSync(directory)
			.some(name => name.startsWith('.sto-wordcraft-')),
		'staging directories removed',
	);
}
function mode(value: string): void {
	process.env.WORDCRAFT_TEST_MODE = value;
	fs.rmSync(log, { force: true });
}

try {
	const archive = new AdmZip();
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{PAGES}} {{FIGURES}} {{TABLES}} {{SOURCES}}</w:t></w:r></w:p></w:body></w:document>`,
		),
	);
	archive.writeZip(inputDocx);
	const original = fs.readFileSync(inputDocx);
	throws(
		() =>
			createWordcraftPdf({
				inputDocx: path.join(directory, 'missing.docx'),
			}),
		/Expected an existing DOCX/,
	);
	throws(
		() => createWordcraftPdf({ inputDocx, timeoutMs: 0 }),
		/positive integer/,
	);
	throws(
		() => createWordcraftPdf({ inputDocx, outputPdf: inputDocx }),
		/extension|aliases/,
	);
	throws(
		() =>
			createWordcraftPdf({
				inputDocx,
				executable: path.join(directory, 'missing-cli'),
			}),
		/Wordcraft.*failed/,
	);
	if (process.platform !== 'win32') {
		fs.writeFileSync(
			fakeCli,
			`#!/usr/bin/env node
const fs = require('node:fs');
const AdmZip = require(${JSON.stringify(require.resolve('adm-zip'))});
let args = process.argv.slice(2);
if (args.includes('--script')) {
 const script = JSON.parse(fs.readFileSync(args[args.indexOf('--script') + 1], 'utf8'));
 args = ['run', '--file', script.file, ...script.commands.flatMap(item => ['--cmd', item.command + (item.params === undefined ? '' : '=' + JSON.stringify(item.params))]), ...(script.save || []).flatMap(file => ['--save', file])];
}
const mode = process.env.WORDCRAFT_TEST_MODE || 'ok';
const log = ${JSON.stringify(log)};
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log(mode === 'version' ? 'wordcraft-cli 0.10.0' : mode === 'future-version' ? 'wordcraft-cli 0.12.0' : 'wordcraft-cli 0.11.0'); }
else if (args[0] === 'run' && args.includes('font.list={"all":true}')) {
 if (mode === 'bad-font-json') console.log('font.list: invalid');
 else if (mode === 'missing-font-catalog') console.log('font.list: {"fonts":[]}');
 else console.log('font.list: ' + JSON.stringify({families: mode === 'font-missing' || (mode.startsWith('font-load') && !args.some(arg => arg.startsWith('font.add='))) ? [] : ['Times New Roman']}));
}
else if (args[0] === 'run') {
 if (mode === 'fail') { console.error('fixture failure'); process.exit(9); }
 if (mode === 'timeout') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
 const source = args[args.indexOf('--file') + 1];
 if (args.includes('document.layout')) { console.log('document.layout: ' + JSON.stringify({pages: [{},{}], caret: null})); process.exit(0); }
 const target = args[args.indexOf('--save') + 1];
 if (target && target.endsWith('.pdf')) {
  fs.writeFileSync(target, '%PDF-1.4\\nfixture');
  if (mode === 'font-load-mutate') {
   const fontCommand = args.find(arg => arg.startsWith('font.add='));
   fs.appendFileSync(JSON.parse(fontCommand.slice('font.add='.length)).path, 'changed during export');
  }
  process.exit(0);
 }
 const xml = new AdmZip(source).readAsText('word/document.xml');
 if (/\\{\\{(?:PAGES|FIGURES|TABLES|SOURCES)\\}\\}/.test(xml)) { console.error('unresolved statistics'); process.exit(8); }
 if (!args.includes('references.updateFields')) process.exit(7);
 if (mode !== 'missing-docx') fs.copyFileSync(source, args[args.indexOf('--save') + 1]);
} else if (args[0] === 'info') {
 const count = calls.filter(call => call[0] === 'info').length;
 console.log(mode === 'bad-json' ? 'not json' : JSON.stringify({ pages: mode === 'bad-pages' ? 0 : mode === 'mismatch' ? count + 2 : mode === 'diverge' ? Math.floor(count / 2) + 2 : 2 }));
} else if (args[0] === 'convert') {
 if (mode !== 'missing-pdf') fs.writeFileSync(args[2], mode === 'invalid-pdf' ? 'not a PDF' : '%PDF-1.4\\nfixture');
} else process.exit(6);
`,
		);
		fs.chmodSync(fakeCli, 0o755);
		mode('version');
		throws(
			() => readWordcraftVersion(fakeCli),
			/Untested Wordcraft version.*0\.10\.0.*expected 0\.11\.0/,
		);
		mode('future-version');
		throws(
			() => readWordcraftVersion(fakeCli),
			/Untested Wordcraft version.*0\.12\.0.*expected 0\.11\.0/,
		);
		mode('ok');
		process.env.WORDCRAFT_CLI = fakeCli;
		const result = createWordcraftPdf({ inputDocx });
		check(
			result.outputPdf === outputPdf &&
				result.manifestPath === manifestPath,
		);
		check(result.pageCount === 2 && result.version === '0.11.0');
		console.log(
			'PASS version gate: accepts 0.11.0, rejects prior 0.10.0 and future 0.12.0.',
		);
		check(
			result.warnings.some(warning =>
				/Experimental.*Word acceptance/.test(warning),
			),
		);
		check(
			fs.readFileSync(inputDocx).equals(original),
			'original DOCX bytes unchanged',
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		check(
			manifest.pdfPageCountVerified === false &&
				manifest.pageCountSource === 'wordcraft-info',
			'manifest identifies the DOCX page-count source',
		);
		check(
			manifest.experimental === true && manifest.wordAccepted === false,
		);
		check(
			/^[a-f0-9]{64}$/.test(manifest.sourceSha256) &&
				/^[a-f0-9]{64}$/.test(manifest.pdfSha256),
		);
		const calls = fs
			.readFileSync(log, 'utf8')
			.trim()
			.split('\n')
			.map(line => JSON.parse(line) as string[]);
		check(
			calls.map(call => call[0]).join(',') ===
				'--version,run,run,info,convert,info,run,info,convert,info',
			'fields updated before info/export, counts converge',
		);
		check(
			calls.every(call => !call.includes(inputDocx)),
			'CLI never receives original DOCX',
		);
		cleanupCheck();
		const acceptedPdf = fs.readFileSync(outputPdf);
		const acceptedManifest = fs.readFileSync(manifestPath);
		check(
			result.fonts.missingFamilies.length === 0 &&
				result.fonts.unverifiedRequirements.length > 0,
			'fixture has only unresolved requirements, with no known missing family',
		);
		mode('ok');
		throws(
			() => createWordcraftPdf({ inputDocx, strictFonts: true }),
			/font requirements are not verified/,
		);
		check(
			fs.readFileSync(inputDocx).equals(original),
			'strict unverified rejection preserves source',
		);
		check(
			fs.readFileSync(outputPdf).equals(acceptedPdf),
			'strict unverified rejection preserves previous PDF',
		);
		check(
			fs.readFileSync(manifestPath).equals(acceptedManifest),
			'strict unverified rejection preserves previous manifest',
		);
		const strictCalls = fs
			.readFileSync(log, 'utf8')
			.trim()
			.split('\n')
			.map(line => JSON.parse(line) as string[]);
		check(
			strictCalls.length === 2 &&
				!strictCalls.some(call =>
					call.includes('references.updateFields'),
				),
			'strict rejection occurs before field updates and PDF export',
		);
		cleanupCheck();
		for (const [failure, pattern] of [
			['fail', /fixture failure/],
			['bad-font-json', /font.list returned invalid JSON/],
			['missing-font-catalog', /available font families/],
			['missing-docx', /updated DOCX/],
			['bad-json', /invalid JSON/],
			['bad-pages', /invalid page count/],
			['mismatch', /changed during export/],
			['diverge', /did not converge/],
			['missing-pdf', /PDF signature/],
			['invalid-pdf', /PDF signature/],
		] as const) {
			mode(failure);
			throws(
				() => createWordcraftPdf({ inputDocx, executable: fakeCli }),
				pattern,
			);
			check(
				fs.readFileSync(outputPdf).equals(acceptedPdf),
				`${failure}: previous PDF preserved`,
			);
			check(
				fs.readFileSync(manifestPath).equals(acceptedManifest),
				`${failure}: previous manifest preserved`,
			);
			check(
				fs.readFileSync(inputDocx).equals(original),
				`${failure}: source preserved`,
			);
			cleanupCheck();
		}
		const fontDocx = path.join(directory, 'font-report.docx');
		const fontArchive = new AdmZip();
		fontArchive.addFile(
			'word/document.xml',
			Buffer.from(
				'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>Known font</w:t></w:r></w:p></w:body></w:document>',
			),
		);
		fontArchive.writeZip(fontDocx);
		const fontSource = fs.readFileSync(fontDocx);
		mode('font-missing');
		throws(
			() =>
				createWordcraftPdf({
					inputDocx: fontDocx,
					outputPdf,
					strictFonts: true,
				}),
			/font requirements are not verified: Times New Roman/,
		);
		check(
			fs.readFileSync(fontDocx).equals(fontSource),
			'strict missing font rejection preserves source',
		);
		check(
			fs.readFileSync(outputPdf).equals(acceptedPdf),
			'strict missing font rejection preserves prior PDF',
		);
		check(
			fs.readFileSync(manifestPath).equals(acceptedManifest),
			'strict missing font rejection preserves prior manifest',
		);
		cleanupCheck();
		mode('ok');
		const verified = createWordcraftPdf({
			inputDocx: fontDocx,
			outputPdf,
			strictFonts: true,
		});
		check(
			verified.fonts.missingFamilies.length === 0 &&
				verified.fonts.unverifiedRequirements.length === 0,
			'strict mode accepts verified requirements',
		);
		const fontFile = path.join(directory, 'times.ttf');
		const strings = ['Times New Roman', 'Regular'].map(value =>
			Buffer.from(value, 'utf16le').swap16(),
		);
		const nameTable = Buffer.alloc(
			30 + strings[0].length + strings[1].length,
		);
		nameTable.writeUInt16BE(2, 2);
		nameTable.writeUInt16BE(30, 4);
		for (let index = 0; index < 2; index++) {
			const offset = 6 + index * 12;
			nameTable.writeUInt16BE(3, offset);
			nameTable.writeUInt16BE(1, offset + 2);
			nameTable.writeUInt16BE(0x0409, offset + 4);
			nameTable.writeUInt16BE(index + 1, offset + 6);
			nameTable.writeUInt16BE(strings[index].length, offset + 8);
			nameTable.writeUInt16BE(index ? strings[0].length : 0, offset + 10);
		}
		strings[0].copy(nameTable, 30);
		strings[1].copy(nameTable, 30 + strings[0].length);
		const fontHeader = Buffer.alloc(28);
		fontHeader.writeUInt32BE(0x00010000);
		fontHeader.writeUInt16BE(1, 4);
		fontHeader.write('name', 12, 'ascii');
		fontHeader.writeUInt32BE(28, 20);
		fontHeader.writeUInt32BE(nameTable.length, 24);
		fs.writeFileSync(fontFile, Buffer.concat([fontHeader, nameTable]));
		const fontHash = createHash('sha256')
			.update(fs.readFileSync(fontFile))
			.digest('hex');
		mode('font-load');
		const loaded = createWordcraftPdf({
			inputDocx: fontDocx,
			outputPdf,
			strictFonts: true,
			fontFiles: [fontFile],
		});
		check(
			loaded.fonts.loadedFiles?.length === 1 &&
				loaded.fonts.loadedFiles[0].path === fontFile &&
				loaded.fonts.loadedFiles[0].sha256 === fontHash,
			'result records exact selected font bytes',
		);
		const loadedPdf = fs.readFileSync(outputPdf);
		const loadedManifest = fs.readFileSync(manifestPath);
		const loadedReceipt = JSON.parse(loadedManifest.toString('utf8'));
		check(
			loadedReceipt.fonts.loadedFiles[0].sha256 === fontHash,
			'manifest preserves font hash',
		);
		check(
			loadedReceipt.pageCountSource === 'wordcraft-document-layout',
			'font-loaded rendering reports actual layout source',
		);
		cleanupCheck();
		mode('font-load-mutate');
		throws(
			() =>
				createWordcraftPdf({
					inputDocx: fontDocx,
					outputPdf,
					strictFonts: true,
					fontFiles: [fontFile],
				}),
			/loaded font file changed/,
		);
		check(
			fs.readFileSync(fontDocx).equals(fontSource),
			'changed font failure preserves source',
		);
		check(
			fs.readFileSync(outputPdf).equals(loadedPdf),
			'changed font failure preserves prior PDF',
		);
		check(
			fs.readFileSync(manifestPath).equals(loadedManifest),
			'changed font failure preserves prior manifest',
		);
		cleanupCheck();
		mode('timeout');
		const start = Date.now();
		throws(
			() =>
				createWordcraftPdf({
					inputDocx,
					executable: fakeCli,
					timeoutMs: 2000,
				}),
			/timed out|ETIMEDOUT/,
		);
		check(
			Date.now() - start < 4000,
			'whole-render timeout bounds the CLI sequence',
		);
		cleanupCheck();
		mode('ok');
		const linkedPdf = path.join(directory, 'linked.pdf');
		fs.symlinkSync(inputDocx, linkedPdf);
		throws(
			() =>
				createWordcraftPdf({
					inputDocx,
					outputPdf: linkedPdf,
					executable: fakeCli,
				}),
			/symbolic links/,
		);
		fs.rmSync(linkedPdf);
		fs.linkSync(inputDocx, linkedPdf);
		throws(
			() =>
				createWordcraftPdf({
					inputDocx,
					outputPdf: linkedPdf,
					executable: fakeCli,
				}),
			/Invalid Wordcraft output/,
		);
		fs.rmSync(linkedPdf);
		fs.rmSync(manifestPath);
		fs.symlinkSync(inputDocx, manifestPath);
		throws(
			() => createWordcraftPdf({ inputDocx, executable: fakeCli }),
			/symbolic links/,
		);
		cleanupCheck();
	} else {
		console.log('POSIX executable-fixture scenarios skipped on Windows.');
	}
} finally {
	if (oldMode === undefined) delete process.env.WORDCRAFT_TEST_MODE;
	else process.env.WORDCRAFT_TEST_MODE = oldMode;
	if (oldExecutable === undefined) delete process.env.WORDCRAFT_CLI;
	else process.env.WORDCRAFT_CLI = oldExecutable;
	fs.rmSync(directory, { recursive: true, force: true });
}
console.log(`Wordcraft renderer tests passed (${assertions} assertions).`);
