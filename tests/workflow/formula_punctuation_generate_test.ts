import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';

import { scaffoldReport } from '@/app/report-scaffold';
import { validateDocxFile } from '@/app/report-workflow';
import { readDocxEntry } from '@/shared/lib/docx';

const tsxCliPath = require.resolve('tsx/cli');

function generate(reportDir: string, outputPath: string, validate = false) {
	return spawnSync(
		process.execPath,
		[
			tsxCliPath,
			'src/index.ts',
			'generate',
			reportDir,
			'--output',
			outputPath,
			'--renderer',
			'portable',
			...(validate ? ['--validate'] : []),
		],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			shell: false,
			timeout: 30000,
			maxBuffer: 1024 * 1024,
		},
	);
}

function documentFrom(xml: string): Document {
	return new JSDOM(xml, { contentType: 'application/xml' }).window.document;
}

function formulaTable(document: Document): Element {
	const table = [...document.getElementsByTagName('w:tbl')].find(
		candidate => candidate.getElementsByTagName('m:oMath').length > 0,
	);
	assert.ok(table, 'Generated DOCX must contain an OMML formula table');
	return table;
}

function explanationParagraph(document: Document): Element {
	const paragraph = [...document.getElementsByTagName('w:p')].find(
		candidate => /^где\s/u.test(candidate.textContent ?? ''),
	);
	assert.ok(paragraph, 'Generated DOCX must contain the formula explanation');
	return paragraph;
}

function setFormulaPunctuation(table: Element, punctuation: string): void {
	const math = table.getElementsByTagName('m:oMath')[0];
	const text = [...math.getElementsByTagName('m:t')].at(-1);
	assert.ok(text, 'Formula must contain a final OMML text node');
	assert.match(text.textContent ?? '', /,$/u);
	text.textContent = text.textContent!.replace(/,$/u, punctuation);
}

function main(): void {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-formula-cli-'));
	try {
		const reportDir = path.join(tempRoot, 'report');
		scaffoldReport({
			slug: 'formula_test',
			dir: reportDir,
			profile: 'lab',
			title: 'Проверка формулы',
			studentName: 'Тестовый Студент',
			supervisorName: 'Тестовый Преподаватель',
			initGit: false,
		});
		const sourcePath = path.join(reportDir, '10_methodology.md');
		const writeFormula = (formula: string, explanation: string): void => {
			fs.writeFileSync(
				sourcePath,
				`# Ход работы\n\n${formula}\n\n${explanation}\n`,
			);
		};

		const invalidCases = [
			[
				'missing-comma',
				'$$ x = 1 $$',
				'где $x$ – переменная.',
				/comma|запят/iu,
			],
			[
				'period',
				'$$ x = 1. $$',
				'где $x$ – переменная.',
				/period|точк/iu,
			],
			[
				'where-colon',
				'$$ x = 1, $$',
				'где: $x$ – переменная.',
				/colon|двоеточ/iu,
			],
			[
				'missing-comma-with-inline-code',
				'$$ x = 1 $$',
				'где $x$ – переменная `code`.',
				/comma|запят/iu,
			],
		] as const;
		for (const [name, formula, explanation, diagnostic] of invalidCases) {
			writeFormula(formula, explanation);
			const newOutput = path.join(tempRoot, name, 'new.docx');
			const rejected = generate(reportDir, newOutput);
			assert.equal(rejected.error, undefined);
			assert.notEqual(
				rejected.status,
				0,
				`${name} must fail ordinary generate`,
			);
			assert.match(rejected.stderr, diagnostic);
			assert.equal(
				fs.existsSync(path.dirname(newOutput)),
				false,
				`${name} must fail before creating the output directory`,
			);
			const existingOutput = path.join(tempRoot, `${name}.docx`);
			const sentinel = Buffer.from(`existing output: ${name}\n`);
			fs.writeFileSync(existingOutput, sentinel);
			const preserved = generate(reportDir, existingOutput);
			assert.equal(preserved.error, undefined);
			assert.notEqual(preserved.status, 0);
			assert.match(preserved.stderr, diagnostic);
			assert.deepEqual(
				fs.readFileSync(existingOutput),
				sentinel,
				`${name} must preserve existing output bytes`,
			);
		}

		fs.writeFileSync(
			sourcePath,
			'# Ход работы\n\nЗначение задано формулой @eq:sample:\n\n$$ x = 1, (@eq:sample) $$\n\nгде $x$ – переменная.\n',
		);
		const output = path.join(tempRoot, 'valid.docx');
		const positive = generate(reportDir, output, true);
		assert.equal(positive.error, undefined);
		assert.equal(positive.status, 0, positive.stderr || positive.stdout);
		assert.match(positive.stdout, /DOCX validation passed/u);
		const xml = readDocxEntry(output, 'word/document.xml');
		const table = formulaTable(documentFrom(xml));
		const cells = [...table.getElementsByTagName('w:tc')];
		assert.equal(
			cells.length,
			3,
			'Numbered formula uses a three-cell layout',
		);
		assert.match(
			cells[1].textContent ?? '',
			/1,$/u,
			'Comma belongs to the expression',
		);
		assert.equal(
			cells[2].textContent?.trim(),
			'(1)',
			'Equation number must not carry the comma',
		);

		function validateMutation(
			name: string,
			mutate: (document: Document) => void,
			diagnostic?: RegExp,
		): void {
			const document = documentFrom(xml);
			mutate(document);
			const mutatedPath = path.join(tempRoot, `${name}.docx`);
			const archive = new AdmZip(output);
			archive.updateFile(
				'word/document.xml',
				Buffer.from(document.documentElement.outerHTML),
			);
			archive.writeZip(mutatedPath);
			const failures = validateDocxFile(
				mutatedPath,
				path.join(tempRoot, `unpack-${name}`),
			).filter(result => !result.passed);
			if (diagnostic) {
				assert.ok(
					failures.some(result =>
						diagnostic.test(
							`${result.check}: ${result.error ?? ''}`,
						),
					),
					`${name}: ${JSON.stringify(failures)}`,
				);
			} else {
				assert.deepEqual(failures, [], `${name} must validate`);
			}
		}
		validateMutation(
			'missing-comma',
			document => setFormulaPunctuation(formulaTable(document), ''),
			/comma|запят/iu,
		);
		validateMutation(
			'period',
			document => setFormulaPunctuation(formulaTable(document), '.'),
			/Formula Punctuation Before Where/u,
		);
		validateMutation(
			'comma-after-number',
			document => {
				const table = formulaTable(document);
				setFormulaPunctuation(table, '');
				const number = table.getElementsByTagName('w:tc')[2];
				const text = [...number.getElementsByTagName('w:t')].at(-1)!;
				text.textContent += ',';
			},
			/comma|запят/iu,
		);
		validateMutation(
			'where-colon',
			document => {
				const text =
					explanationParagraph(document).getElementsByTagName(
						'w:t',
					)[0];
				text.textContent = text.textContent!.replace('где', 'где:');
			},
			/colon|двоеточ/iu,
		);
		validateMutation(
			'abbreviation-without-final-period',
			document => {
				const text = [
					...explanationParagraph(document).getElementsByTagName(
						'w:t',
					),
				].at(-1)!;
				text.textContent = text.textContent!.replace(
					'переменная.',
					'значение в усл. единицах',
				);
			},
			/final.*period|period.*end|точк/iu,
		);
		validateMutation('abbreviation-with-final-period', document => {
			const text = [
				...explanationParagraph(document).getElementsByTagName('w:t'),
			].at(-1)!;
			text.textContent = text.textContent!.replace(
				'переменная.',
				'значение в усл. ед.',
			);
		});
		for (const punctuation of ['', ',']) {
			validateMutation(
				`consecutive-${punctuation ? 'valid' : 'missing'}`,
				document => {
					const second = formulaTable(document);
					const first = second.cloneNode(true) as Element;
					setFormulaPunctuation(first, punctuation);
					second.parentNode!.insertBefore(first, second);
				},
				punctuation ? undefined : /consecutive|последоват/iu,
			);
		}
		fs.writeFileSync(
			sourcePath,
			'# Ход работы\n\nЗначение задано формулой @eq:multiline:\n\n$$\nx = 1,\n(@eq:multiline)\n$$\n\nгде $x$ – переменная `code`.\n',
		);
		const multilineOutput = path.join(tempRoot, 'multiline.docx');
		const multiline = generate(reportDir, multilineOutput, true);
		assert.equal(multiline.error, undefined);
		assert.equal(multiline.status, 0, multiline.stderr || multiline.stdout);
		assert.match(multiline.stdout, /DOCX validation passed/u);
		const multilineXml = readDocxEntry(
			multilineOutput,
			'word/document.xml',
		);
		assert.doesNotMatch(multilineXml, /@eq:/u);
		const multilineCells = formulaTable(
			documentFrom(multilineXml),
		).getElementsByTagName('w:tc');
		assert.match(multilineCells[1].textContent ?? '', /1,$/u);
		assert.equal(multilineCells[2].textContent?.trim(), '(1)');
		console.log(
			'Formula punctuation generate integration passed: 8 rejection/preservation cases, single-line and multiline numbered OMML output, 8 DOCX mutations.',
		);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
		assert.equal(
			fs.existsSync(tempRoot),
			false,
			'Temporary fixtures must be removed',
		);
	}
}

main();
