import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from '@/app/builder';
import {
	NUMBERED_HEADING_STYLE_IDS,
	STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
	STRUCTURAL_HEADING_STYLE_ID,
} from '@/shared/config';
import { readDocxEntry, unpackDocx } from '@/shared/lib/docx-archive';
import { validateSTO } from '@/shared/lib/sto-validator';

const tempRoot = path.join(process.cwd(), '.agent-work', 'generated-docx');
const outputDocx = path.join(tempRoot, 'example.docx');
const genericPresetDocx = path.join(tempRoot, 'example-generic-preset.docx');
const unpackedDir = path.join(tempRoot, 'unpacked');
const STYLE_NAME_ASSERTIONS = new Map<string, string>([
	['Normal', '+Абзац с отступом 1-ой строки'],
	[STRUCTURAL_HEADING_STYLE_ID, '+ЗАГОЛОВОК по центру'],
	[STRUCTURAL_HEADING_NO_TOC_STYLE_ID, '+ЗаголРеферСодерж'],
	['FigureCaption', '+№ - Название рисунка'],
	['TableCaption', '+№ - Название таблицы'],
	['TableText', '+Текст в таблице'],
	['TitlePageText', '+Тит_Абзац по центру'],
	['TOC1', '+Оглавление 1'],
	['TOC2', '+Оглавление 2'],
	['TOC3', '+Оглавление 3'],
	['TOC4', '+Оглавление 4'],
]);

STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[0], '+Заголовок 1 уровня');
STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[1], '+Заголовок 2 уровня');
STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[2], '+Заголовок 3 уровня');
STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[3], '+Заголовок 4 уровня');
STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[4], 'heading 5');
STYLE_NAME_ASSERTIONS.set(NUMBERED_HEADING_STYLE_IDS[5], 'heading 6');

function findStyleXml(stylesXml: string, styleId: string): string {
	const match = new RegExp(
		`<w:style\\b(?=[^>]*\\bw:styleId="${styleId}")[\\s\\S]*?<\\/w:style>`,
	).exec(stylesXml);
	assert.ok(match, `Style ${styleId} must exist`);
	return match[0];
}

function getStyleName(styleXml: string): string {
	const match = /<w:name\b[^>]*\bw:val="([^"]+)"/.exec(styleXml);
	assert.ok(match, 'Style must include w:name');
	return match[1];
}

function stripStyleNames(styleXml: string): string {
	return styleXml.replace(/<w:name\b[^>]*\/>/g, '<w:name/>');
}

function assertDefaultDotmStyleNames(): void {
	const defaultStylesXml = readDocxEntry(outputDocx, 'word/styles.xml');
	const genericStylesXml = readDocxEntry(
		genericPresetDocx,
		'word/styles.xml',
	);

	for (const [styleId, expectedName] of STYLE_NAME_ASSERTIONS) {
		const defaultStyleXml = findStyleXml(defaultStylesXml, styleId);
		const genericStyleXml = findStyleXml(genericStylesXml, styleId);
		assert.equal(getStyleName(defaultStyleXml), expectedName);
		assert.equal(
			stripStyleNames(defaultStyleXml),
			stripStyleNames(genericStyleXml),
			`${styleId} changed beyond display name`,
		);
	}
}

function assertDefaultDotmStyleProperties(): void {
	const stylesXml = readDocxEntry(outputDocx, 'word/styles.xml');
	const expectedProperties = new Map<string, RegExp[]>([
		[
			'StoHeading1',
			[
				/<w:keepNext\b/,
				/<w:keepLines\b/,
				/<w:numPr\b/,
				/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="120")(?=[^>]*w:line="360")/,
				/<w:ind\b(?=[^>]*w:firstLine="709")/,
			],
		],
		[
			STRUCTURAL_HEADING_STYLE_ID,
			[
				/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="120")(?=[^>]*w:line="360")/,
				/<w:pageBreakBefore\b/,
			],
		],
		[
			STRUCTURAL_HEADING_NO_TOC_STYLE_ID,
			[
				/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="240")(?=[^>]*w:line="240")/,
				/<w:pageBreakBefore\b/,
			],
		],
		[
			'TitlePageText',
			[
				/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="0")(?=[^>]*w:line="240")/,
				/<w:sz\b(?=[^>]*w:val="28")/,
			],
		],
		['TOC1', [/<w:jc\b(?=[^>]*w:val="left")/]],
		['FigureCaption', [/<w:keepLines\b/]],
		['TableCaption', [/<w:keepNext\b/, /<w:keepLines\b/]],
	]);

	for (const [styleId, patterns] of expectedProperties) {
		const styleXml = findStyleXml(stylesXml, styleId);
		for (const pattern of patterns) {
			assert.match(styleXml, pattern, `${styleId} is missing ${pattern}`);
		}
	}
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });

	await buildReport('example', outputDocx);
	await buildReport('example', genericPresetDocx, {
		stylePreset: 'default',
	});
	assertDefaultDotmStyleNames();
	assertDefaultDotmStyleProperties();
	unpackDocx(outputDocx, unpackedDir);

	const failed = validateSTO(unpackedDir).filter(result => !result.passed);
	assert.deepEqual(
		failed.map(result => `${result.check}: ${result.error ?? 'failed'}`),
		[],
	);

	console.log('Generated DOCX validation test passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
