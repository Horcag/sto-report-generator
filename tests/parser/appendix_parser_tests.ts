import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx-archive';

function getWordText(xml: string): string {
	return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(match => match[1])
		.join('');
}

function paragraphContaining(xml: string, text: string): string {
	const paragraph = xml
		.match(/<w:p\b[\s\S]*?<\/w:p>/g)
		?.find(paragraphXml => getWordText(paragraphXml).includes(text));
	assert.ok(paragraph, `Expected paragraph containing "${text}".`);
	return paragraph;
}

async function packAndReadXml(
	children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
	outputPath: string,
): Promise<{ documentXml: string }> {
	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [{ children }],
	});
	fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
	return { documentXml: readDocxEntry(outputPath, 'word/document.xml') };
}

export async function runAppendixParserTests(tempRoot: string): Promise<void> {
	const appendixElements = await parseMarkdownToDocx(
		String.raw`Рисунок 1 – Основная схема (@fig:main)

\sto_structural_heading{ПРИЛОЖЕНИЕ А}

# Расчётные данные

На рисунке @fig:a показаны данные, в таблице @tab:a приведены числа; формула @eq:a описывает итог.

Рисунок 1 – Схема приложения (@fig:a)

Таблица 1 – Числа приложения (@tab:a)

$$x=1 (@eq:a)$$
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: appendixXml } = await packAndReadXml(
		appendixElements,
		path.join(tempRoot, 'appendix-numbering.docx'),
	);
	assert.match(getWordText(appendixXml), /Рисунок А\.1/);
	assert.match(getWordText(appendixXml), /Таблица А\.1/);
	assert.match(getWordText(appendixXml), /рисунке А\.1/);
	assert.match(getWordText(appendixXml), /Приложение А/);
	assert.match(
		getWordText(paragraphContaining(appendixXml, 'Приложение А')),
		/Расчётные данные/,
	);
	assert.match(getWordText(appendixXml), /\(А\.1\)/);

	const explicitAppendixElements = await parseMarkdownToDocx(
		String.raw`\sto_structural_heading{СОДЕРЖАНИЕ}

\sto_appendix{А}{Расчётные данные}

# Проверка

Данные приведены в \sto_appendix_ref{А}.

На рисунке @fig:explicit показана схема.

Рисунок 1 – Схема (@fig:explicit)
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: explicitAppendixXml } = await packAndReadXml(
		explicitAppendixElements,
		path.join(tempRoot, 'explicit-appendix.docx'),
	);
	const explicitHeading = paragraphContaining(
		explicitAppendixXml,
		'Приложение А',
	);
	assert.ok(explicitHeading?.includes('w:val="AppendixHeading"'));
	assert.match(explicitHeading, /w:br\s*\//);
	assert.match(
		explicitAppendixXml,
		/TC &quot;Приложение А\. Расчётные данные&quot; \\f A \\l 1/,
	);
	assert.match(explicitAppendixXml, /<w:fldChar w:fldCharType="begin"\/>/);
	assert.doesNotMatch(explicitAppendixXml, /<w:fldSimple w:instr="TC/);
	assert.match(getWordText(explicitAppendixXml), /А\.1 Проверка/);
	assert.match(
		getWordText(explicitAppendixXml),
		/Данные приведены в приложении А\./,
	);
	assert.match(getWordText(explicitAppendixXml), /Рисунок А\.1/);
	assert.match(explicitAppendixXml, /TOC \\f &quot;A&quot;/);
	const appendixStylesXml = readDocxEntry(
		path.join(tempRoot, 'explicit-appendix.docx'),
		'word/styles.xml',
	);
	const appendixStyle =
		/<w:style\b(?=[^>]*w:styleId="AppendixHeading")[\s\S]*?<\/w:style>/.exec(
			appendixStylesXml,
		)?.[0];
	assert.match(appendixStyle ?? '', /<w:jc w:val="center"\/>/);
	assert.match(appendixStyle ?? '', /<w:pageBreakBefore\/>/);
	await assert.rejects(
		parseMarkdownToDocx(
			String.raw`Данные приведены в \sto_appendix_ref{Б}.

\sto_appendix{А}{Расчётные данные}`,
			{},
			{ sourceDir: tempRoot },
		),
		/Unknown appendix reference: Б/,
	);
	const codeExample = await parseMarkdownToDocx(
		'Буквальный пример: `\\sto_appendix_ref{Б}`.',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: codeExampleXml } = await packAndReadXml(
		codeExample,
		path.join(tempRoot, 'appendix-code-example.docx'),
	);
	assert.match(getWordText(codeExampleXml), /\\sto_appendix_ref\{Б\}/);
	const twoAppendices = await parseMarkdownToDocx(
		String.raw`См. \sto_appendix_ref{А} и \sto_appendix_ref{Б}.

\sto_appendix{А}{Первое приложение}

Рисунок 1 – Первый (@fig:first)

\sto_appendix{Б}{Второе приложение}

Рисунок 1 – Второй (@fig:second)
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: twoAppendicesXml } = await packAndReadXml(
		twoAppendices,
		path.join(tempRoot, 'two-appendices.docx'),
	);
	assert.match(getWordText(twoAppendicesXml), /Рисунок А\.1/);
	assert.match(getWordText(twoAppendicesXml), /Рисунок Б\.1/);
	assert.match(
		twoAppendicesXml,
		/TC &quot;Приложение А\. Первое приложение&quot; \\f A \\l 1/,
	);
	assert.match(
		twoAppendicesXml,
		/TC &quot;Приложение Б\. Второе приложение&quot; \\f A \\l 1/,
	);
}
