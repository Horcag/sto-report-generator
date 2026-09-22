import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer } from 'docx';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { STO_NUMBERING, STO_STYLES } from '@/shared/config';
import { readDocxEntry } from '@/shared/lib/docx-archive';

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
	assert.ok(
		orderedBibliographyJson.indexOf('Второй источник') <
			orderedBibliographyJson.indexOf('Первый источник'),
		'Bibliography must follow first citation order, not BibTeX order.',
	);

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

	// Test table formatting: pagination, explicit widths, Markdown alignment and <br>.
	const tableDocPath = path.join(tempRoot, 'table-test.docx');
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
		tableDocPath,
	);

	assert.match(
		tableDocXml,
		/<w:tblHeader\/>/,
		'Table header row must have tblHeader',
	);
	assert.match(
		tableDocXml,
		/<w:cantSplit\/>/,
		'Table rows must have cantSplit',
	);
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
	assert.match(tableDocXml, /<w:br\/>/, '<br> tags must produce w:br runs');
	assert.match(
		tableDocXml,
		/w:w="2807"/,
		'Column widths from explicit widths hint must be applied',
	);

	// Test widths comment preceding Table Caption paragraph ("Таблица X – ...")
	const tableCaptionDocPath = path.join(tempRoot, 'table-caption-test.docx');
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
		tableCaptionDocPath,
	);
	assert.match(
		tableCaptionDocXml,
		/w:w="3742"/,
		'Explicit widths hint preceding table caption must not be cleared',
	);

	console.log('Parser tests passed.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
