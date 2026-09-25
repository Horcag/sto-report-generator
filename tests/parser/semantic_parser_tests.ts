import assert from 'node:assert/strict';
import path from 'node:path';

import { parseMarkdownToDocx } from '@/features/markdown-parser';

interface SemanticParserHarness {
	tempRoot: string;
	packAndReadXml: (
		children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
		outputPath: string,
	) => Promise<{ documentXml: string; numberingXml: string }>;
	expectRejects: (markdown: string, expectedMessage: RegExp) => Promise<void>;
	getWordText: (xml: string) => string;
}

export async function runSemanticParserTests({
	tempRoot,
	packAndReadXml,
	expectRejects,
	getWordText,
}: SemanticParserHarness): Promise<void> {
	const semanticElements = await parseMarkdownToDocx(
		String.raw`\sto_structural_heading{РЕФЕРАТ}

\sto_referat_characteristics{Оценена точность метода.}

\sto_referat_application{Метод используется в архиве.}

\sto_structural_heading{ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ}

\begin{sto_terms}
АБВ | Автоматический блок выбора
Бета | коэффициент | рад
\end{sto_terms}`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: semanticXml } = await packAndReadXml(
		semanticElements,
		path.join(tempRoot, 'semantic-blocks.docx'),
	);
	assert.match(semanticXml, /Основные характеристики:/);
	assert.match(semanticXml, /Область применения:/);
	for (const label of ['Основные характеристики:', 'Область применения:']) {
		const paragraph = semanticXml
			.match(/<w:p\b[\s\S]*?<\/w:p>/g)
			?.find(xml => getWordText(xml).includes(label));
		assert.ok(paragraph);
		const labelRun = paragraph
			.match(/<w:r\b[\s\S]*?<\/w:r>/g)
			?.find(xml => getWordText(xml).includes(label));
		assert.ok(labelRun);
		assert.doesNotMatch(labelRun, /<w:b\b/);
	}
	assert.match(
		semanticXml,
		/<w:tbl[\s\S]*Автоматический блок выбора[\s\S]*коэффициент, рад[\s\S]*<\/w:tbl>/,
	);
	const termsTable = semanticXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/)?.[0];
	assert.ok(termsTable);
	const termsRows = termsTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
	assert.equal(termsRows.length, 2);
	for (const row of termsRows) {
		assert.equal((row.match(/<w:tc\b/g) ?? []).length, 2);
	}
	await expectRejects(
		String.raw`\sto_referat_application{Архив документов.}`,
		/under the РЕФЕРАТ heading/,
	);
	await expectRejects(
		String.raw`\begin{sto_terms}
Бета | коэффициент
Альфа | величина
\end{sto_terms}`,
		/alphabetical order/,
	);
	const inlineListElements = await parseMarkdownToDocx(
		String.raw`Простые: \sto_inline_list{simple}{цвет|форма|размер}. Сложные: \sto_inline_list{complex}{цвет, измеренный утром|форма, полученная расчетом}.`,
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: inlineListXml } = await packAndReadXml(
		inlineListElements,
		path.join(tempRoot, 'inline-lists.docx'),
	);
	assert.match(
		getWordText(inlineListXml),
		/Простые: цвет, форма, размер\. Сложные: цвет, измеренный утром; форма, полученная расчетом\./,
	);
	await expectRejects(
		String.raw`Признаки: \sto_inline_list{simple}{цвет, оттенок|форма}.`,
		/simple items must not contain commas/,
	);
}
