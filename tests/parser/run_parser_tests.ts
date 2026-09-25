import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';

import { buildReport } from '@/app/builder';
import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx-archive';

import { runCitationLocatorTests } from './citation_locator_tests';

const tempRoot = path.join(process.cwd(), '.agent-work', 'parser-tests');

async function expectRejects(
	markdown: string,
	expectedMessage: RegExp,
): Promise<void> {
	await assert.rejects(
		() => parseMarkdownToDocx(markdown, {}, { sourceDir: tempRoot }),
		expectedMessage,
	);
}

function getWordText(xml: string): string {
	return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
		.map(match => match[1])
		.join('')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function paragraphContaining(xml: string, text: string): string {
	const paragraph = xml
		.match(/<w:p\b[\s\S]*?<\/w:p>/g)
		?.find(paragraphXml => getWordText(paragraphXml).includes(text));
	assert.ok(paragraph, `Expected paragraph containing "${text}".`);
	return paragraph;
}

function numberingLevelContaining(xml: string, levelPattern: RegExp): string {
	const level = xml
		.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g)
		?.find(levelXml => levelPattern.test(levelXml));
	assert.ok(
		level,
		'Expected numbering level matching the requested pattern.',
	);
	return level;
}

async function packAndReadXml(
	children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
	outputPath: string,
): Promise<{ documentXml: string; numberingXml: string }> {
	const doc = new Document({
		styles: STO_STYLES,
		numbering: STO_NUMBERING,
		sections: [{ children }],
	});
	fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
	return {
		documentXml: readDocxEntry(outputPath, 'word/document.xml'),
		numberingXml: readDocxEntry(outputPath, 'word/numbering.xml'),
	};
}

async function main(): Promise<void> {
	fs.rmSync(tempRoot, { recursive: true, force: true });
	fs.mkdirSync(tempRoot, { recursive: true });
	await expectRejects(
		'Ошибка $x=\\frac{1}{$ в строке.',
		/Formula conversion failed/,
	);
	await expectRejects('$$x=\\frac{1}{$$', /Formula conversion failed/);
	const invalidReportDir = path.join(tempRoot, 'invalid-formula-report');
	fs.mkdirSync(invalidReportDir);
	fs.copyFileSync(
		path.join(process.cwd(), 'example', '00_metadata.md'),
		path.join(invalidReportDir, '00_metadata.md'),
	);
	fs.writeFileSync(
		path.join(invalidReportDir, '10_main.md'),
		'Tекст.\n\n$$x=\\frac{1}{$$\n',
	);
	await assert.rejects(
		() =>
			buildReport(invalidReportDir, path.join(tempRoot, 'invalid.docx')),
		/Formula conversion failed.*10_main\.md:3/,
	);

	const codeLines = [
		'const escaped = "&amp; &lt; &#39;";',
		'const url = "https://example.org/a?x=1&y=2";',
		'\treturn escaped;  ',
		'',
		'    done();',
	];
	const codeElements = await parseMarkdownToDocx(
		['```js', ...codeLines, '```'].join('\n'),
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: codeXml } = await packAndReadXml(
		codeElements,
		path.join(tempRoot, 'literal-code.docx'),
	);
	const codeParagraph = codeXml.match(/<w:p\b[\s\S]*?<\/w:p>/)?.[0];
	assert.ok(codeParagraph);
	const actualCodeLines = codeParagraph
		.split(/<w:br\s*\/>/)
		.map(line => getWordText(line));
	assert.deepEqual(actualCodeLines, codeLines);
	assert.doesNotMatch(codeParagraph, /\u200b/);

	await parseMarkdownToDocx(
		String.raw`\begin{sto_list}
- корректный пункт
\end{sto_list}
`,
		{},
		{ sourceDir: tempRoot },
	);

	await expectRejects(
		String.raw`\begin{itemize}
- bad
\end{itemize}
`,
		/Unsupported STO environment/,
	);

	await expectRejects(
		String.raw`\begin{sto_list}
- bad
\end{sto_enum}
`,
		/Unsupported STO environment block/,
	);

	await expectRejects(
		String.raw`\begin{sto_list}
- bad
`,
		/Unclosed STO environment/,
	);

	const bibPath = path.join(tempRoot, 'references.bib');
	fs.writeFileSync(
		bibPath,
		`@book{used,
  author={Иванов, И. И.},
  title={Использованный источник},
  publisher={Самара},
  year={2020}
}
@book{unused,
  author={Петров, П. П.},
  title={Неиспользованный источник},
  publisher={Самара},
  year={2021}
}
@book{first,
  author={Первый, П. П.},
  title={Первый источник},
  publisher={Самара},
  year={2022}
}
@book{second,
  author={Второй, В. В.},
  title={Второй источник},
  publisher={Самара},
  year={2023}
}`,
		'utf8',
	);
	const bibliographyElements = await parseMarkdownToDocx(
		String.raw`Текст с использованным источником [@used].

\begin{sto_bibliography}
\end{sto_bibliography}
`,
		{ bibliography: bibPath },
		{ sourceDir: tempRoot },
	);
	const bibliographyJson = JSON.stringify(bibliographyElements);
	assert.match(bibliographyJson, /Использованный источник/);
	assert.doesNotMatch(bibliographyJson, /Неиспользованный источник/);

	const { documentXml: bibliographyXml, numberingXml } = await packAndReadXml(
		bibliographyElements,
		path.join(tempRoot, 'bibliography.docx'),
	);
	const sourceParagraph = paragraphContaining(
		bibliographyXml,
		'Использованный источник',
	);
	assert.match(
		sourceParagraph,
		/<w:spacing\b(?=[^>]*w:before="0")(?=[^>]*w:after="0")(?=[^>]*w:line="360")(?=[^>]*w:lineRule="auto")/,
	);
	assert.match(
		sourceParagraph,
		/<w:ind\b(?=[^>]*w:left="0")(?=[^>]*w:right="0")(?=[^>]*w:firstLine="709")/,
	);
	assert.match(sourceParagraph, /<w:tab\b[^>]*w:val="left"[^>]*w:pos="1134"/);
	assert.match(sourceParagraph, /<w:jc\b[^>]*w:val="both"/);
	const bibliographyNumberingLevel = numberingLevelContaining(
		numberingXml,
		/<w:lvlText w:val="%1"\/>[\s\S]*?<w:ind\b(?=[^>]*w:left="720")(?=[^>]*w:hanging="360")/,
	);
	assert.match(
		bibliographyNumberingLevel,
		/<w:ind\b(?=[^>]*w:left="720")(?=[^>]*w:hanging="360")/,
	);
	assert.match(bibliographyNumberingLevel, /<w:suff\b[^>]*w:val="tab"/);

	const referatElements = await parseMarkdownToDocx(
		String.raw`\sto_structural_heading{РЕФЕРАТ}

КЛЮЧЕВОЕ СЛОВО, ВТОРОЕ СЛОВО, ТРЕТЬЕ СЛОВО, ЧЕТВЕРТОЕ СЛОВО, ПЯТОЕ СЛОВО
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: referatXml } = await packAndReadXml(
		referatElements,
		path.join(tempRoot, 'referat.docx'),
	);
	const keywordsParagraph = paragraphContaining(referatXml, 'КЛЮЧЕВОЕ СЛОВО');
	assert.match(
		keywordsParagraph,
		/<w:spacing\b(?=[^>]*w:before="360")(?=[^>]*w:after="240")(?=[^>]*w:line="360")(?=[^>]*w:lineRule="auto")/,
	);
	assert.match(
		keywordsParagraph,
		/<w:ind\b(?=[^>]*w:left="0")(?=[^>]*w:right="0")(?=[^>]*w:firstLine="709")/,
	);
	assert.match(keywordsParagraph, /<w:caps\/>/);

	const nonReferatElements = await parseMarkdownToDocx(
		'ПЕРВЫЙ ТЕРМИН, ВТОРОЙ ТЕРМИН, ТРЕТИЙ ТЕРМИН, ЧЕТВЕРТЫЙ ТЕРМИН, ПЯТЫЙ ТЕРМИН',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: nonReferatXml } = await packAndReadXml(
		nonReferatElements,
		path.join(tempRoot, 'non-referat-keywords.docx'),
	);
	const nonReferatParagraph = paragraphContaining(
		nonReferatXml,
		'ПЕРВЫЙ ТЕРМИН',
	);
	assert.doesNotMatch(nonReferatParagraph, /<w:caps\/>/);
	assert.doesNotMatch(nonReferatParagraph, /<w:smallCaps\/>/);
	assert.doesNotMatch(nonReferatParagraph, /w:before="360"/);
	assert.doesNotMatch(nonReferatParagraph, /w:after="240"/);

	const orderedBibliographyElements = await parseMarkdownToDocx(
		String.raw`Сначала второй источник [@second; @first], потом повтор [@second].

\begin{sto_bibliography}
\end{sto_bibliography}
`,
		{ bibliography: bibPath },
		{ sourceDir: tempRoot },
	);
	const orderedBibliographyJson = JSON.stringify(orderedBibliographyElements);
	assert.match(
		orderedBibliographyJson,
		/Сначала второй источник \[1, 2\], потом повтор \[1\]/,
	);
	assert.ok(
		orderedBibliographyJson.indexOf('Второй источник') <
			orderedBibliographyJson.indexOf('Первый источник'),
		'Bibliography must follow first citation order, not BibTeX order.',
	);
	await runCitationLocatorTests(bibPath, tempRoot);

	fs.writeFileSync(bibPath, '', 'utf8');
	await assert.rejects(
		() =>
			parseMarkdownToDocx(
				String.raw`Текст с отсутствующим источником [@missing].

\begin{sto_bibliography}
\end{sto_bibliography}
`,
				{ bibliography: bibPath },
				{ sourceDir: tempRoot },
			),
		/Citation source not found/,
	);

	const tableElements = await parseMarkdownToDocx(
		String.raw`<!-- widths: 30, 70 -->
| Заголовок 1 | Заголовок 2 <br> вторая строка |
| :---: | ---: |
| Ячейка 1 | Текст <br> с переносом |
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: tableDocXml } = await packAndReadXml(
		tableElements,
		path.join(tempRoot, 'table-test.docx'),
	);
	assert.match(tableDocXml, /<w:tblHeader\/>/);
	assert.match(tableDocXml, /<w:cantSplit\/>/);
	assert.doesNotMatch(
		tableDocXml,
		/<w:b\/>/,
		'Table headers must not be made bold implicitly',
	);
	assert.match(
		tableDocXml,
		/<w:jc w:val="center"\/>/,
		'Markdown center alignment must be preserved in the header',
	);
	assert.match(tableDocXml, /<w:br\/>/);
	assert.match(tableDocXml, /w:w="2807"/);

	const tableCaptionElements = await parseMarkdownToDocx(
		String.raw`<!-- widths: 40, 60 -->
Таблица 1 – Тестовая таблица
| Кол 1 | Кол 2 |
| :--- | :--- |
| Данные 1 | Данные 2 |
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: tableCaptionDocXml } = await packAndReadXml(
		tableCaptionElements,
		path.join(tempRoot, 'table-caption-test.docx'),
	);
	assert.match(
		tableCaptionDocXml,
		/w:w="3742"/,
		'Explicit widths before a table caption must be preserved',
	);

	const headingElements = await parseMarkdownToDocx(
		'# 1 Основной раздел\n\n## 1.1 Подраздел\n\n# 2026 год\n\n# 12 причин',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: headingXml } = await packAndReadXml(
		headingElements,
		path.join(tempRoot, 'heading-test.docx'),
	);
	const headingParagraph = paragraphContaining(headingXml, 'Основной раздел');
	assert.ok(getWordText(headingParagraph).includes('Основной раздел'));
	assert.ok(
		!getWordText(headingParagraph).startsWith('1 Основной раздел'),
		'Heading text must have leading section number stripped.',
	);
	assert.equal(
		getWordText(paragraphContaining(headingXml, '2026 год')),
		'2026 год',
		'A year at the start of a heading is content, not a section number.',
	);
	assert.equal(
		getWordText(paragraphContaining(headingXml, '12 причин')),
		'12 причин',
		'A quantity at the start of a heading must not be discarded.',
	);

	const captionElements = await parseMarkdownToDocx(
		String.raw`Рисунок 1 – Название схемы (@fig:schema)

Таблица 1 – Данные расчета (@tab:calc)
`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: captionXml } = await packAndReadXml(
		captionElements,
		path.join(tempRoot, 'caption-test.docx'),
	);
	const figParagraph = paragraphContaining(captionXml, 'Название схемы');
	assert.ok(
		!getWordText(figParagraph).includes('(1)'),
		'Figure caption must strip trailing anchor label without leaving (1).',
	);
	const tabParagraph = paragraphContaining(captionXml, 'Данные расчета');
	assert.ok(
		!getWordText(tabParagraph).includes('(1)'),
		'Table caption must strip trailing anchor label without leaving (1).',
	);

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
	assert.match(getWordText(appendixXml), /ПРИЛОЖЕНИЕ А/);
	assert.match(
		getWordText(paragraphContaining(appendixXml, 'ПРИЛОЖЕНИЕ А')),
		/Расчётные данные/,
	);
	assert.match(getWordText(appendixXml), /\(А\.1\)/);

	const russianListElements = await parseMarkdownToDocx(
		String.raw`\begin{sto_list}
а) *первый* пункт задачи [@used];
  б) вложенный пункт задачи;
    в) глубоко вложенный пункт задачи;
1) третий пункт задачи.
\end{sto_list}
`,
		{ bibliography: bibPath },
		{ sourceDir: tempRoot },
	);
	const { documentXml: russianListXml } = await packAndReadXml(
		russianListElements,
		path.join(tempRoot, 'russian-list-test.docx'),
	);
	const russianA = paragraphContaining(russianListXml, 'первый пункт задачи');
	const russianB = paragraphContaining(
		russianListXml,
		'вложенный пункт задачи',
	);
	const russianC = paragraphContaining(
		russianListXml,
		'глубоко вложенный пункт задачи',
	);
	const numericItem = paragraphContaining(
		russianListXml,
		'третий пункт задачи',
	);
	assert.ok(getWordText(russianA).includes('а) первый пункт задачи'));
	assert.ok(!getWordText(russianA).includes('- а)'));
	assert.ok(getWordText(russianA).includes('[1]'));
	assert.match(russianA, /<w:i\/>/);
	assert.ok(getWordText(russianB).includes('б) вложенный пункт задачи'));
	assert.ok(!getWordText(russianB).includes('- б)'));
	assert.match(russianB, /<w:ind\b(?=[^>]*w:left="709")/);
	assert.ok(
		getWordText(russianC).includes('в) глубоко вложенный пункт задачи'),
	);
	assert.match(russianC, /<w:ind\b(?=[^>]*w:left="1418")/);
	assert.ok(getWordText(numericItem).includes('1) третий пункт задачи'));
	assert.ok(!getWordText(numericItem).includes('1. третий пункт задачи'));
	assert.doesNotMatch(russianListXml, /Courier New/);
	assert.notEqual(
		russianA,
		russianB,
		'Russian letter list items must be separate paragraphs.',
	);

	console.log('Parser tests passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
