import assert from 'node:assert/strict';
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
const args = process.argv.slice(2);
const mode = process.env.WORDCRAFT_TEST_MODE || 'ok';
const log = ${JSON.stringify(log)};
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === '--version') { console.log(mode === 'version' ? 'wordcraft-cli 0.8.0' : mode === 'future-version' ? 'wordcraft-cli 0.10.0' : 'wordcraft-cli 0.9.0'); }
else if (args[0] === 'run') {
 if (mode === 'fail') { console.error('fixture failure'); process.exit(9); }
 if (mode === 'timeout') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
 const source = args[args.indexOf('--file') + 1];
 const xml = new AdmZip(source).readAsText('word/document.xml');
 if (/\\{\\{(?:PAGES|FIGURES|TABLES|SOURCES)\\}\\}/.test(xml)) { console.error('unresolved statistics'); process.exit(8); }
 if (args[args.indexOf('--cmd') + 1] !== 'references.updateFields') process.exit(7);
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
			/Untested Wordcraft version.*0\.8\.0.*expected 0\.9\.0/,
		);
		mode('future-version');
		throws(
			() => readWordcraftVersion(fakeCli),
			/Untested Wordcraft version.*0\.10\.0.*expected 0\.9\.0/,
		);
		mode('ok');
		process.env.WORDCRAFT_CLI = fakeCli;
		const result = createWordcraftPdf({ inputDocx });
		check(
			result.outputPdf === outputPdf &&
				result.manifestPath === manifestPath,
		);
		check(result.pageCount === 2 && result.version === '0.9.0');
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
				'--version,run,info,convert,info,run,info,convert,info',
			'fields updated before info/export, counts converge',
		);
		check(
			calls.every(call => !call.includes(inputDocx)),
			'CLI never receives original DOCX',
		);
		cleanupCheck();
		const acceptedPdf = fs.readFileSync(outputPdf);
		const acceptedManifest = fs.readFileSync(manifestPath);
		for (const [failure, pattern] of [
			['fail', /fixture failure/],
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
