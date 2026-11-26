import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { buildReport } from '@/app/builder';
import {
	normalizeDocxNumbering,
	readDocxEntry,
	splitSharedAbstractNumbering,
	unpackDocx,
} from '@/shared/lib/docx';
import { validateSTO } from '@/shared/lib/sto-validator';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function testSplitUnitBehavior(): void {
	const singleUse = `${HEADER}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
	assert.equal(splitSharedAbstractNumbering(singleUse), singleUse);

	const sharedXml = `${HEADER}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:tmpl w:val="AABBCCDD"/><w:name w:val="ordered-numbering"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="4"><w:styleLink w:val="Heading1"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="4"/></w:num><w:num w:numId="4"><w:abstractNumId w:val="4"/></w:num><w:numIdMacAtCleanup w:val="4"/></w:numbering>`;

	const splitOnce = splitSharedAbstractNumbering(sharedXml);
	assert.ok(splitOnce.startsWith(HEADER));
	assert.equal(
		splitSharedAbstractNumbering(splitOnce),
		splitOnce,
		'Splitting shared abstract numbering must be idempotent.',
	);

	const dom = new JSDOM(splitOnce, { contentType: 'text/xml' });
	try {
		const numbering = dom.window.document.documentElement;
		const childNames = [...numbering.children].map(el => el.localName);
		const firstNumIndex = childNames.indexOf('num');
		const lastAbstractIndex = childNames.lastIndexOf('abstractNum');
		const cleanupIndex = childNames.indexOf('numIdMacAtCleanup');
		assert.ok(
			lastAbstractIndex >= 0 && lastAbstractIndex < firstNumIndex,
			'CT_Numbering requires all <w:abstractNum> elements before <w:num>.',
		);
		assert.ok(cleanupIndex > firstNumIndex);

		const absElements = [...numbering.children].filter(
			el => el.localName === 'abstractNum',
		);
		assert.equal(absElements.length, 3);

		const orderedAbstracts = absElements.filter(
			el =>
				![...el.children].some(
					c =>
						c.localName === 'styleLink' ||
						c.localName === 'numStyleLink',
				),
		);
		assert.equal(orderedAbstracts.length, 2);

		const nsids = orderedAbstracts.map(el => {
			assert.equal(
				el.firstElementChild?.localName,
				'nsid',
				'CT_AbstractNum requires <w:nsid> as first child.',
			);
			const val = el.firstElementChild.getAttributeNS(W, 'val') ?? '';
			assert.match(val, /^[0-9A-F]{8}$/u);
			return val;
		});
		assert.equal(new Set(nsids).size, 2);

		const tmpls = orderedAbstracts.map(el =>
			[...el.children]
				.find(c => c.localName === 'tmpl')
				?.getAttributeNS(W, 'val'),
		);
		assert.equal(new Set(tmpls).size, 2);

		const numToAbs = new Map(
			[...numbering.children]
				.filter(el => el.localName === 'num')
				.map(el => [
					el.getAttributeNS(W, 'numId'),
					[...el.children]
						.find(c => c.localName === 'abstractNumId')
						?.getAttributeNS(W, 'val'),
				]),
		);
		assert.notEqual(numToAbs.get('1'), numToAbs.get('2'));
		assert.equal(
			numToAbs.get('3'),
			numToAbs.get('4'),
			'Style-linked abstractNum must remain shared.',
		);
	} finally {
		dom.window.close();
	}

	const withoutNumbering = new AdmZip();
	withoutNumbering.addFile('word/document.xml', Buffer.from('<w:document/>'));
	const rawWithoutNumbering = withoutNumbering.toBuffer();
	assert.strictEqual(
		normalizeDocxNumbering(rawWithoutNumbering),
		rawWithoutNumbering,
	);
}

async function testBuildReportIsolation(): Promise<void> {
	const tempRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), 'sto-list-numbering-'),
	);
	const reportDir = path.join(tempRoot, 'report');
	const outDocx = path.join(tempRoot, 'out.docx');
	const unpackedDir = path.join(tempRoot, 'unpacked');

	try {
		fs.mkdirSync(reportDir, { recursive: true });
		fs.writeFileSync(
			path.join(reportDir, '00_metadata.md'),
			`---
title: Проверка нумерации списков
type: ОТЧЕТ О НАУЧНО-ИССЛЕДОВАТЕЛЬСКОЙ РАБОТЕ
bibliography: references.bib
---
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '01_referat.md'),
			`\\sto_structural_heading{РЕФЕРАТ}

Отчет {{PAGES}} с., {{FIGURES}} рис., {{TABLES}} табл., {{SOURCES}} источн.
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '02_toc.md'),
			`\\sto_structural_heading{СОДЕРЖАНИЕ}
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '03_intro.md'),
			`\\sto_structural_heading{ВВЕДЕНИЕ}

Во введении рассмотрен источник [@book2024].
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '04_lists.md'),
			`# 1 Раздел со списками

Первый нумерованный перечень:

\\begin{sto_enum}
1. Первый пункт;
   а) подпункт А;
   б) подпункт Б;
2. Второй пункт;
3. Третий пункт.
\\end{sto_enum}

Второй независимый нумерованный перечень:

\\begin{sto_enum}
1. Начальный шаг;
2. Заключительный шаг.
\\end{sto_enum}

Первый маркированный перечень:

\\begin{sto_list}
- элемент альфа;
- элемент бета.
\\end{sto_list}

Второй маркированный перечень:

\\begin{sto_list}
- элемент гамма;
- элемент дельта.
\\end{sto_list}
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '90_conclusion.md'),
			`\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

Итоги приведены в разделе 1.
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, '91_sources.md'),
			`\\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}

\\begin{sto_bibliography}
\\end{sto_bibliography}
`,
			'utf8',
		);
		fs.writeFileSync(
			path.join(reportDir, 'references.bib'),
			`@book{book2024,
  author = {Иванов, И. И.},
  title = {Основы обработки данных},
  address = {Самара},
  publisher = {Самарский университет},
  year = {2024},
  numpages = {120}
}
`,
			'utf8',
		);

		await buildReport(reportDir, outDocx);
		unpackDocx(outDocx, unpackedDir);

		const docXml = readDocxEntry(outDocx, 'word/document.xml');
		const numberingXml = readDocxEntry(outDocx, 'word/numbering.xml');
		assert.ok(docXml && numberingXml);

		const usedNumIds = new Set(
			[...(docXml.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/g) ?? [])]
				.map(b => /<w:numId\b[^>]*\bw:val="([^"]+)"/.exec(b)?.[1])
				.filter((id): id is string => Boolean(id && id !== '0')),
		);
		assert.ok(
			usedNumIds.size >= 5,
			`Expected >= 5 distinct active numIds (heading + lists + bibliography), got ${usedNumIds.size}.`,
		);

		const dom = new JSDOM(numberingXml, { contentType: 'text/xml' });
		try {
			const numbering = dom.window.document.documentElement;
			const numToAbs = new Map<string, string>();
			for (const num of numbering.getElementsByTagNameNS(W, 'num')) {
				const nid = num.getAttributeNS(W, 'numId');
				const aid = num
					.getElementsByTagNameNS(W, 'abstractNumId')[0]
					?.getAttributeNS(W, 'val');
				if (nid && aid) {
					numToAbs.set(nid, aid);
				}
			}
			const usedAbstracts = [...usedNumIds].map(nid => numToAbs.get(nid));
			assert.equal(
				new Set(usedAbstracts).size,
				usedNumIds.size,
				'Every used list numId must resolve to an isolated abstractNumId.',
			);
		} finally {
			dom.window.close();
		}

		const results = validateSTO(unpackedDir);
		const isolationCheck = results.find(
			r => r.check === 'List Abstract Numbering Isolation',
		);
		assert.ok(
			isolationCheck?.passed,
			isolationCheck?.error ??
				'List Abstract Numbering Isolation failed.',
		);
		const failures = results.filter(r => !r.passed);
		assert.deepEqual(
			failures,
			[],
			`Unexpected STO validation failures: ${failures.map(f => `${f.check}: ${f.error}`).join('; ')}`,
		);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

async function run(): Promise<void> {
	testSplitUnitBehavior();
	await testBuildReportIsolation();
	console.log(
		'List abstract numbering isolation unit and DOCX build tests passed.',
	);
}

run().catch(error => {
	console.error(error);
	process.exit(1);
});
