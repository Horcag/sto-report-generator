import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { buildReport } from '@/app/builder';
import { readDocxEntry, unpackDocx } from '@/shared/lib/docx';
import {
	enforceStrictStoDocx,
	isStrictStoDocx,
	normalizeStrictStoBuffer,
} from '@/shared/lib/docx/strict-sto';
import { inspectStrictStoXml } from '@/shared/lib/docx/strict-sto/validation';
import {
	MATH_NS,
	withXml,
	wordElements,
} from '@/shared/lib/docx/strict-sto/xml';
import { validateSTO } from '@/shared/lib/sto-validator';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-strict-test-'));
const strictPath = path.join(directory, 'strict.docx');
const ordinaryPath = path.join(directory, 'ordinary.docx');

function parts(buffer: Buffer): Map<string, string> {
	return new Map(
		new AdmZip(buffer)
			.getEntries()
			.filter(entry =>
				/^word\/(?:document|styles|numbering|footer\d*)\.xml$/.test(
					entry.entryName,
				),
			)
			.map(entry => [entry.entryName, entry.getData().toString('utf8')]),
	);
}

function text(xml: string): string[] {
	return withXml(xml, document =>
		wordElements(document, 't').map(node => node.textContent ?? ''),
	);
}

function math(xml: string): string[] {
	return withXml(xml, document =>
		Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath')).map(
			node => node.outerHTML,
		),
	);
}

async function main(): Promise<void> {
	try {
		const input = path.join(directory, 'input.md');
		fs.writeFileSync(
			input,
			[
				'---',
				'title: Тест строгого режима',
				'---',
				'',
				String.raw`\sto_structural_heading{ВВЕДЕНИЕ}`,
				'',
				'# Раздел проверки',
				'',
				'Текст с `a < b && c` и *курсивом*.',
				'',
				'```text',
				'  a &= 1',
				'print("ё")',
				'```',
				'',
				String.raw`$$ \stovec{x} = \frac{a}{b} $$`,
				'',
			].join('\n'),
		);
		await buildReport(input, ordinaryPath, { stylePreset: 'default' });
		await buildReport(input, strictPath, { stylePreset: 'sto-strict' });
		assert.equal(isStrictStoDocx(ordinaryPath), false);
		assert.equal(isStrictStoDocx(strictPath), true);
		assert.match(
			readDocxEntry(strictPath, 'word/settings.xml'),
			/<w:doNotExpandShiftReturn\b/,
		);
		assert.doesNotMatch(
			readDocxEntry(ordinaryPath, 'word/settings.xml'),
			/<w:doNotExpandShiftReturn\b/,
		);
		assert.match(
			readDocxEntry(strictPath, 'word/footer1.xml'),
			/<w:ind\b[^>]*w:firstLine="0"/,
		);
		assert.throws(() => enforceStrictStoDocx(ordinaryPath), /marker/);
		const ordinary = readDocxEntry(ordinaryPath, 'word/document.xml');
		const strict = readDocxEntry(strictPath, 'word/document.xml');
		assert.ok(ordinary.includes('Courier New'));
		assert.equal(strict.includes('Courier New'), false);
		assert.deepEqual(
			text(strict),
			text(ordinary),
			'Текст и пробелы кода сохранены',
		);
		assert.deepEqual(
			math(strict),
			math(ordinary),
			'Математическая семантика не меняется',
		);
		assert.ok(strict.includes('<w:i/>'), 'Курсив не запрещён пунктом 3.2');
		const originalParts = parts(fs.readFileSync(strictPath));
		assert.deepEqual(inspectStrictStoXml(originalParts), {
			bold: true,
			font: true,
			color: true,
			size: true,
			spacing: true,
			numberingFont: true,
		});
		const twice = parts(
			normalizeStrictStoBuffer(fs.readFileSync(strictPath)),
		);
		assert.deepEqual(
			twice,
			originalParts,
			'Повторная нормализация идемпотентна',
		);
		const cases: Array<
			[
				string,
				string,
				(xml: string) => string,
				keyof ReturnType<typeof inspectStrictStoXml>,
			]
		> = [
			[
				'bold',
				'word/document.xml',
				xml => xml.replace('<w:b w:val="0"/>', '<w:b/>'),
				'bold',
			],
			[
				'font',
				'word/document.xml',
				xml =>
					xml.replace('w:ascii="Times New Roman"', 'w:ascii="Arial"'),
				'font',
			],
			[
				'size',
				'word/document.xml',
				xml => xml.replace('<w:sz w:val="28"/>', '<w:sz w:val="20"/>'),
				'size',
			],
			[
				'color',
				'word/document.xml',
				xml => xml.replace('w:val="000000"', 'w:val="FF0000"'),
				'color',
			],
			[
				'theme',
				'word/document.xml',
				xml =>
					xml.replace(
						'w:ascii="Times New Roman"',
						'w:ascii="Times New Roman" w:asciiTheme="minorHAnsi"',
					),
				'font',
			],
			[
				'spacing',
				'word/document.xml',
				xml => xml.replace('w:line="360"', 'w:line="240"'),
				'spacing',
			],
			[
				'numbering',
				'word/numbering.xml',
				xml =>
					xml.replace('w:ascii="Times New Roman"', 'w:ascii="Arial"'),
				'numberingFont',
			],
			[
				'footer',
				'word/footer1.xml',
				xml =>
					xml.replace('w:ascii="Times New Roman"', 'w:ascii="Arial"'),
				'font',
			],
			[
				'numbering-color',
				'word/numbering.xml',
				xml => xml.replace('w:val="000000"', 'w:val="FF0000"'),
				'numberingFont',
			],
			[
				'numbering-theme-color',
				'word/numbering.xml',
				xml =>
					xml.replace(
						'w:val="000000"',
						'w:val="000000" w:themeColor="accent1"',
					),
				'numberingFont',
			],
		];
		for (const [name, part, mutate, check] of cases) {
			const changed = new Map(originalParts);
			const before = changed.get(part);
			assert.ok(before, `Найден раздел ${part}`);
			const after = mutate(before);
			assert.notEqual(after, before, `Мутация ${name} выполнена`);
			changed.set(part, after);
			assert.equal(
				inspectStrictStoXml(changed)[check],
				false,
				`Нарушение ${name} обнаружено`,
			);
		}
		const smaller = new Map(
			Array.from(originalParts, ([name, xml]) => [
				name,
				xml.replaceAll('w:val="28"', 'w:val="24"'),
			]),
		);
		assert.ok(inspectStrictStoXml(smaller).size, 'СТО допускает 12 пт');
		const unpacked = path.join(directory, 'unpacked');
		unpackDocx(strictPath, unpacked);
		const checks = validateSTO(unpacked).filter(result =>
			result.check.startsWith('Strict STO '),
		);
		assert.equal(checks.length, 6, 'Все шесть строгих проверок выполнены');
		assert.ok(
			checks.every(result => result.passed),
			JSON.stringify(checks),
		);
		assert.equal(
			validateSTO(unpacked).some(
				result => result.check === 'Title Page Base Style',
			),
			false,
		);
		console.log(
			`Strict STO: generation, default preservation, math/code integrity, idempotence, ${cases.length} negative controls and six validator checks passed.`,
		);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
