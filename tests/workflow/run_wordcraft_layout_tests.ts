import assert from 'node:assert/strict';
import childProcess, {
	spawnSync,
	type SpawnSyncOptions,
} from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import {
	normalizeWordcraftTables,
	readWordcraftLayout,
} from '@/app/wordcraft-layout';
import { createWordcraftPdf } from '@/app/wordcraft-renderer';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), 'sto-wordcraft-layout-'),
);
const source = path.join(directory, 'source.docx');
const staged = path.join(directory, 'staged.docx');
const engine = path.join(directory, 'wordcraft-cli');
const snapshot = path.join(directory, 'exported.docx');
const log = path.join(directory, 'probes.jsonl');
const oldMode = process.env.WORDCRAFT_LAYOUT_TEST_MODE;
let checks = 0;

function fixture(): void {
	const archive = new AdmZip();
	const header =
		'<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr>';
	const rows = Array.from(
		{ length: 5 },
		(_, index) =>
			`<w:tr><w:tc><w:p><w:bookmarkStart w:id="${index}" w:name="row${index}"/><w:hyperlink r:id="rId1"><w:r><w:rPr><w:b/></w:rPr><w:t>Строка ${index + 1}</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="${index}"/></w:p></w:tc></w:tr>`,
	).join('');
	archive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document xmlns:w="${WORD}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="TableCaption"/></w:pPr><w:r><w:t>Таблица 1 – Данные</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>${header}${rows}</w:tbl><w:sectPr/></w:body></w:document>`,
		),
	);
	archive.addFile(
		'word/styles.xml',
		Buffer.from(
			`<w:styles xmlns:w="${WORD}"><w:style w:styleId="TableCaption"><w:name w:val="TableCaption"/></w:style></w:styles>`,
		),
	);
	archive.addFile('word/media/payload.bin', Buffer.from([0, 42, 255]));
	archive.writeZip(source);
	fs.copyFileSync(source, staged);
	fs.rmSync(log, { force: true });
}

function installEngine(): void {
	fs.writeFileSync(
		engine,
		String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const AdmZip = require(${JSON.stringify(require.resolve('adm-zip'))});
const { JSDOM } = require(${JSON.stringify(require.resolve('jsdom'))});
const args = process.argv.slice(2);
const mode = process.env.WORDCRAFT_LAYOUT_TEST_MODE || 'ok';
const WORD = ${JSON.stringify(WORD)};
const emit = (command, value) => console.log(command + ': ' + JSON.stringify(value));
const read = filename => new JSDOM(new AdmZip(filename).readAsText('word/document.xml'), {contentType: 'text/xml'}).window.document;
const children = (node, name) => Array.from(node.children).filter(child => child.localName === name);
function positions(filename) {
 const doc = read(filename);
 const blocks = Array.from(doc.getElementsByTagNameNS(WORD, 'body')[0].children).filter(node => node.localName !== 'sectPr');
 const tables = blocks.filter(node => node.localName === 'tbl');
 const counts = tables.map(table => children(table, 'tr').length);
 const tableOffset = table => counts.slice(0, tables.indexOf(table)).reduce((sum, count) => sum + Math.ceil(count / 3), 0);
 const moved = blocks[0].getElementsByTagNameNS(WORD, 'pageBreakBefore').length > 0;
 const orphan = mode === 'orphan' && !moved;
 const count = Math.max(1, counts.reduce((sum, value) => sum + Math.ceil(value / 3), 0) + (orphan ? 1 : 0));
 return { blocks, counts, pages: Array.from({length: count}, () => ({number: 700})), page(pos) {
  const block = blocks[pos.path[0]];
  if (!block) throw new Error('bad probe block');
  if (block.localName === 'p') {
   const next = blocks[pos.path[0] + 1];
   if (!next || next.localName !== 'tbl') throw new Error('caption not next to table');
   return tableOffset(next);
  }
  if (!children(block, 'tr')[pos.path[1]]) throw new Error('stale row probe');
  return tableOffset(block) + Math.floor(pos.path[1] / 3) + (orphan ? 1 : 0);
 }};
}
if (args[0] === '--version') console.log('wordcraft-cli 0.10.0');
else if (args.includes('--script')) {
 const script = JSON.parse(fs.readFileSync(args[args.indexOf('--script') + 1], 'utf8'));
 const state = positions(script.file);
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({file: script.file, counts: state.counts, paths: script.commands.filter(item => item.command === 'caret.set').map(item => item.params.pos.path), pages: script.commands.filter(item => item.command === 'caret.set').map(item => state.page(item.params.pos))}) + '\n');
 let pos;
 for (const item of script.commands) {
  if (item.command === 'font.add') continue;
  if (item.command === 'caret.set') {
   pos = item.params.pos;
   if (mode !== 'missing-caret') emit('caret.set', {focus: {...pos, path: mode === 'redirected' ? [999] : pos.path}});
  } else if (item.command === 'document.layout' && mode !== 'missing-layout') {
   if (mode === 'malformed') console.log('document.layout: {broken');
   else emit('document.layout', {pages: state.pages, caret: {page: mode === 'invalid-page' ? 700 : state.page(pos), x: 10, y: 20, h: 12}});
  }
 }
} else if (args[0] === 'run') {
 const filename = args[args.indexOf('--file') + 1];
 const command = args[args.indexOf('--cmd') + 1];
 if (command.startsWith('font.list')) emit('font.list', {families: ['Times New Roman']});
 else if (command === 'references.updateFields') fs.copyFileSync(filename, args[args.indexOf('--save') + 1]);
 else if (command === 'document.layout') emit('document.layout', {pages: positions(filename).pages, caret: null});
 else throw new Error('unexpected run command');
} else if (args[0] === 'info') console.log(JSON.stringify({pages: positions(args[1]).pages.length}));
else if (args[0] === 'convert') {
 fs.copyFileSync(args[1], ${JSON.stringify(snapshot)});
 fs.writeFileSync(args[2], '%PDF-1.4\nfixture');
} else throw new Error('unexpected invocation');
`,
	);
	fs.chmodSync(engine, 0o755);
}

function invoke(args: string[]): string {
	const result = spawnSync(process.execPath, [engine, ...args], {
		encoding: 'utf8',
		timeout: 20_000,
	});
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}
function check(name: string, run: () => void): void {
	run();
	checks++;
	console.log(`PASS ${name}`);
}
function normalizedDocument(filename: string): Document {
	return new JSDOM(new AdmZip(filename).readAsText('word/document.xml'), {
		contentType: 'text/xml',
	}).window.document;
}
function checkRows(filename: string): void {
	const doc = normalizedDocument(filename);
	const tables = Array.from(doc.getElementsByTagNameNS(WORD, 'tbl'));
	assert.deepEqual(
		tables.map(table => table.getElementsByTagNameNS(WORD, 'tr').length),
		[3, 3, 2],
	);
	const dataRows = tables.flatMap(table =>
		Array.from(table.getElementsByTagNameNS(WORD, 'tr')).slice(1),
	);
	assert.deepEqual(
		dataRows.map(row => row.textContent),
		['Строка 1', 'Строка 2', 'Строка 3', 'Строка 4', 'Строка 5'],
	);
	assert.deepEqual(
		dataRows.map(row =>
			row
				.getElementsByTagNameNS(WORD, 'bookmarkStart')[0]
				.getAttributeNS(WORD, 'id'),
		),
		['0', '1', '2', '3', '4'],
	);
	for (const table of tables)
		assert.equal(table.getElementsByTagNameNS(WORD, 'tblHeader').length, 1);
	for (const row of dataRows) {
		assert.equal(
			row
				.getElementsByTagNameNS(WORD, 'hyperlink')[0]
				.getAttributeNS(
					'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
					'id',
				),
			'rId1',
		);
		assert.equal(row.getElementsByTagNameNS(WORD, 'b').length, 1);
	}
	assert.deepEqual(
		new AdmZip(filename).getEntry('word/media/payload.bin')!.getData(),
		Buffer.from([0, 42, 255]),
	);
}

try {
	installEngine();
	check(
		'layout counts physical pages despite unrelated displayed page numbers',
		() => {
			fixture();
			assert.equal(readWordcraftLayout(invoke, staged), 2);
			for (const output of [
				'',
				'document.layout: {broken',
				'document.layout: {"pages":[]}',
				'document.layout: {"pages":[{}]}\ndocument.layout: {"pages":[{}]}',
			])
				assert.throws(
					() => readWordcraftLayout(() => output, staged),
					/layout result|invalid JSON|physical pages/,
				);
		},
	);
	for (const [mode, error] of [
		['missing-layout', /every requested/],
		['missing-caret', /every requested/],
		['redirected', /redirected/],
		['invalid-page', /physical page/],
		['malformed', /invalid JSON/],
	] as const) {
		check(`rejects ${mode} streamed probe responses`, () => {
			fixture();
			process.env.WORDCRAFT_LAYOUT_TEST_MODE = mode;
			const before = fs.readFileSync(staged);
			assert.throws(
				() =>
					normalizeWordcraftTables({
						invoke,
						docx: staged,
						temporaryDir: directory,
					}),
				error,
			);
			assert.deepEqual(fs.readFileSync(staged), before);
		});
	}
	check(
		'row pages are recomputed after every split with real repeated headers and rich rows',
		() => {
			fixture();
			process.env.WORDCRAFT_LAYOUT_TEST_MODE = 'ok';
			const original = fs.readFileSync(source);
			const report = normalizeWordcraftTables({
				invoke,
				docx: staged,
				temporaryDir: directory,
			});
			assert.equal(report.splits, 2);
			assert.equal(report.verifiedTables, 3);
			assert.deepEqual(report.warnings, []);
			assert.deepEqual(fs.readFileSync(source), original);
			checkRows(staged);
			const calls = fs
				.readFileSync(log, 'utf8')
				.trim()
				.split('\n')
				.map(
					line =>
						JSON.parse(line) as {
							counts: number[];
							paths: number[][];
							pages: number[];
						},
				);
			assert.ok(calls.some(call => call.counts.join(',') === '6'));
			assert.ok(calls.some(call => call.counts.join(',') === '3,4'));
			assert.ok(calls.some(call => call.counts.join(',') === '3,3,2'));
			assert.ok(
				calls.some(call =>
					call.paths.some(
						position => position.length === 1 && position[0] === 4,
					),
				),
				'continuation caption receives a physical-page probe',
			);
			const finalTable = calls.find(
				call =>
					call.counts.join(',') === '3,3,2' &&
					call.paths.some(
						position => position.length === 1 && position[0] === 4,
					),
			);
			assert.ok(finalTable);
			assert.ok(
				finalTable.paths.every(
					(position, index) =>
						(position[0] !== 4 && position[0] !== 5) ||
						finalTable.pages[index] === 2,
				),
				'continuation caption, header and body share physical page 2 while displayed number is 700',
			);
		},
	);
	check(
		'orphan caption moves together with table before row splitting',
		() => {
			fixture();
			process.env.WORDCRAFT_LAYOUT_TEST_MODE = 'orphan';
			const report = normalizeWordcraftTables({
				invoke,
				docx: staged,
				temporaryDir: directory,
			});
			assert.equal(report.verifiedTables, 3);
			assert.equal(
				normalizedDocument(staged).getElementsByTagNameNS(
					WORD,
					'pageBreakBefore',
				).length,
				3,
			);
			checkRows(staged);
		},
	);
	check(
		'renderer mutates staged copies and preserves source bytes through publication',
		() => {
			fixture();
			process.env.WORDCRAFT_LAYOUT_TEST_MODE = 'ok';
			const original = fs.readFileSync(source);
			const rawSpawn = childProcess.spawnSync;
			const engineSpawn = mock.method(
				childProcess,
				'spawnSync',
				(
					executable: string,
					args: string[],
					options?: SpawnSyncOptions,
				) =>
					executable === engine
						? rawSpawn(process.execPath, [engine, ...args], options)
						: rawSpawn(executable, args, options),
			);
			syncBuiltinESMExports();
			try {
				const result = createWordcraftPdf({
					inputDocx: source,
					executable: engine,
					outputPdf: path.join(directory, 'result.pdf'),
					timeoutMs: 120_000,
				});
				assert.equal(result.pageCount, 3);
				assert.equal(result.tables.verifiedTables, 3);
				assert.equal(result.tables.splits, 2);
				assert.deepEqual(fs.readFileSync(source), original);
				checkRows(snapshot);
				const calls = fs
					.readFileSync(log, 'utf8')
					.trim()
					.split('\n')
					.map(line => JSON.parse(line) as { file: string });
				assert.ok(calls.every(call => call.file !== source));
				assert.equal(
					fs
						.readdirSync(directory)
						.some(name => name.startsWith('.sto-wordcraft-')),
					false,
				);
			} finally {
				engineSpawn.mock.restore();
				syncBuiltinESMExports();
			}
		},
	);
	console.log(`Wordcraft layout tests: ${checks} passed.`);
} finally {
	if (oldMode === undefined) delete process.env.WORDCRAFT_LAYOUT_TEST_MODE;
	else process.env.WORDCRAFT_LAYOUT_TEST_MODE = oldMode;
	fs.rmSync(directory, { recursive: true, force: true });
	assert.equal(fs.existsSync(directory), false);
}
