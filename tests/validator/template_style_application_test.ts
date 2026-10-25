import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Document, Packer } from 'docx';
import { JSDOM } from 'jsdom';
import { Tokens } from 'marked';

import { parseMarkdownToDocx } from '@/features/markdown-parser';
import { handleParagraph } from '@/features/markdown-parser/lib/parser/handlers/block-handlers';
import { handleStoFlag } from '@/features/markdown-parser/lib/parser/handlers/sto-handler';
import { ParserContext } from '@/features/markdown-parser/lib/types';
import { getStoStyles, STO_NUMBERING } from '@/shared/config';
import { readDotmStyles } from '@/shared/lib/dotm-style-contract';

import contract from '../fixtures/validator/etalon/dotm-style-contract.json';
import {
	assertEffectiveHeadingBold,
	assertPortableHeadingRuns,
	assertTemplateStyleOrder,
} from './template_style_order_assertions';

const namespace =
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = path.join(
	process.cwd(),
	'tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm',
);

function parseXml(xml: string): XMLDocument {
	return new JSDOM(xml, { contentType: 'text/xml' }).window.document;
}

function generatorId(sourceId: string): string {
	const style = contract.styles.find(item => item.id === sourceId);
	assert.ok(style, `Independent inventory must contain ${sourceId}`);
	return (
		(contract.generatorStyleIds as Record<string, string>)[sourceId] ??
		sourceId
	);
}

async function main(): Promise<void> {
	const children = await parseMarkdownToDocx(
		String.raw`
\sto_structural_heading{РЕФЕРАТ}

МОДЕЛЬ, СИСТЕМА, АНАЛИЗ, МЕТОД, ДАННЫЕ

\sto_structural_heading{ВВЕДЕНИЕ}

Текст основного абзаца.

Таблица 1 – Проверка

| Левый | Центр | Правый |
| :--- | :---: | ---: |
| Данные | Середина | 42 |

Рисунок 1 – Подпись

\begin{sto_list}
- Первый элемент.
\end{sto_list}

$$x = 1$$

\sto_appendix{А}{Контрольное приложение}

# Дополнительный раздел
`,
		{},
	);
	const context: ParserContext = {
		itemMap: new Map(),
		citations: ['sample'],
		listInstanceCounter: 0,
		bibDb: [
			{
				citationKey: 'sample',
				entryType: 'book',
				entryTags: {
					title: 'Контрольный источник',
					author: 'Иванов, Иван',
					address: 'Самара',
					publisher: 'Университет',
					year: '2022',
					pages: '120',
				},
			},
		],
	};
	children.push(
		...(await handleStoFlag(
			{
				type: 'stoFlag',
				raw: '',
				flagType: 'environment',
				envName: 'sto_bibliography',
				tokens: [],
			},
			context,
			async () => [],
			{},
		)),
	);
	children.push(
		...(await handleParagraph(
			{
				type: 'paragraph',
				raw: '',
				text: '',
				tokens: [{ type: 'image', raw: '', href: '', text: '' }],
			} as Tokens.Paragraph,
			context,
			async () => [],
			{},
		)),
	);
	const archive = new AdmZip(
		await Packer.toBuffer(
			new Document({
				styles: getStoStyles(),
				numbering: STO_NUMBERING,
				sections: [{ children }],
			}),
		),
	);
	const stylesDocument = parseXml(archive.readAsText('word/styles.xml'));
	const styles = Array.from(
		stylesDocument.getElementsByTagNameNS(namespace, 'style'),
	);
	assertTemplateStyleOrder(styles, namespace);
	assertPortableHeadingRuns(styles, namespace);
	assertEffectiveHeadingBold(styles, namespace);
	const schema = spawnSync(
		'uv',
		['run', 'python', 'tests/quality/validate_style_schema.py'],
		{
			input: archive.readAsText('word/styles.xml'),
			encoding: 'utf8',
			timeout: 30_000,
		},
	);
	assert.equal(
		schema.status,
		0,
		schema.stderr || schema.error?.message || schema.stdout,
	);
	assert.ok(
		schema.stdout.includes(
			`validated ${styles.length} generated style definitions`,
		),
		'Independent XSD validation must discover every generated style',
	);
	const byId = new Map(
		styles.map(style => [
			style.getAttributeNS(namespace, 'styleId'),
			style,
		]),
	);
	assert.equal(byId.size, styles.length, 'Style IDs must be unique');
	const names = styles.map(style =>
		style
			.getElementsByTagNameNS(namespace, 'name')[0]
			.getAttributeNS(namespace, 'val'),
	);
	assert.equal(
		new Set(names).size,
		names.length,
		'Word must see exactly one style per display name',
	);
	for (const source of readDotmStyles(fixture)) {
		const id = generatorId(source.id);
		const generated = byId.get(id);
		assert.ok(
			generated,
			`Native style ${source.id} (${source.name}) must be imported`,
		);
		assert.equal(
			generated.getAttributeNS(namespace, 'type'),
			source.type,
			`${source.id} type`,
		);
		assert.equal(
			generated
				.getElementsByTagNameNS(namespace, 'name')[0]
				.getAttributeNS(namespace, 'val'),
			source.name,
			`${source.id} native display name`,
		);
		const original = parseXml(
			`<w:styles xmlns:w="${namespace}">${source.xml}</w:styles>`,
		);
		const originalStyle = original.getElementsByTagNameNS(
			namespace,
			'style',
		)[0];
		for (const attribute of Array.from(originalStyle.attributes)) {
			if (attribute.localName !== 'styleId')
				assert.equal(
					generated.getAttributeNS(
						attribute.namespaceURI,
						attribute.localName,
					),
					attribute.value,
					`${source.id} preserves ${attribute.name}`,
				);
		}
		for (const child of Array.from(originalStyle.children)) {
			if (
				['name', 'basedOn', 'next', 'link', 'pPr', 'rPr'].includes(
					child.localName,
				)
			)
				continue;
			assert.equal(
				generated.getElementsByTagNameNS(namespace, child.localName)[0]
					?.outerHTML,
				child.outerHTML,
				`${source.id} preserves metadata ${child.localName}`,
			);
		}
		for (const property of originalStyle.getElementsByTagNameNS(
			namespace,
			'suppressAutoHyphens',
		)) {
			assert.ok(
				generated.getElementsByTagNameNS(namespace, property.localName)
					.length,
				`${source.id} retains hyphenation control`,
			);
		}
		const originalLink = original
			.getElementsByTagNameNS(namespace, 'link')[0]
			?.getAttributeNS(namespace, 'val');
		if (originalLink)
			assert.equal(
				generated
					.getElementsByTagNameNS(namespace, 'link')[0]
					?.getAttributeNS(namespace, 'val'),
				generatorId(originalLink),
				`${source.id} linked character/paragraph style`,
			);
		{
			for (const relation of ['basedOn', 'next']) {
				const dependency = original
					.getElementsByTagNameNS(namespace, relation)[0]
					?.getAttributeNS(namespace, 'val');
				assert.equal(
					generated
						.getElementsByTagNameNS(namespace, relation)[0]
						?.getAttributeNS(namespace, 'val'),
					dependency ? generatorId(dependency) : undefined,
					`${source.id} preserves its original ${relation} dependency`,
				);
			}
		}
	}
	for (const style of styles) {
		for (const relation of ['basedOn', 'next', 'link']) {
			for (const dependency of Array.from(
				style.getElementsByTagNameNS(namespace, relation),
			)) {
				const id = dependency.getAttributeNS(namespace, 'val');
				assert.ok(
					byId.has(id),
					`${style.getAttributeNS(namespace, 'styleId')} has unresolved ${relation} ${id}`,
				);
			}
		}
	}

	const numbering = parseXml(archive.readAsText('word/numbering.xml'));
	const numberingIds = new Set(
		Array.from(numbering.getElementsByTagNameNS(namespace, 'num')).map(
			element => element.getAttributeNS(namespace, 'numId'),
		),
	);
	for (const reference of Array.from(
		stylesDocument.getElementsByTagNameNS(namespace, 'numId'),
	)) {
		assert.ok(
			numberingIds.has(reference.getAttributeNS(namespace, 'val')),
			'Style numbering must resolve in the output package',
		);
	}
	assert.equal(
		archive
			.getEntries()
			.some(entry => /vbaProject|\.dotm$/i.test(entry.entryName)),
		false,
	);
	const document = parseXml(archive.readAsText('word/document.xml'));
	const paragraphs = Array.from(
		document.getElementsByTagNameNS(namespace, 'p'),
	);
	for (const [text, expected] of [
		['МОДЕЛЬ, СИСТЕМА', 'ReferatKeywords'],
		['Текст основного абзаца.', 'Normal'],
		['Таблица 1', 'TableCaption'],
		['Левый', 'TableTextCenter'],
		['Данные', 'TableText'],
		['Середина', 'TableTextCenter'],
		['42', 'TableTextRight'],
		['Рисунок 1', 'FigureCaption'],
		['Первый элемент.', 'ListParagraph'],
		['Контрольный источник', 'Bibliography'],
		['Контрольное приложение', 'AppendixHeading'],
		['Дополнительный раздел', 'AppendixSectionHeading'],
	]) {
		const paragraph = paragraphs.find(element =>
			element.textContent?.includes(text),
		);
		assert.ok(paragraph, `Expected paragraph containing ${text}`);
		assert.equal(
			paragraph
				.getElementsByTagNameNS(namespace, 'pStyle')[0]
				?.getAttributeNS(namespace, 'val'),
			expected,
			`${text} uses its semantic named style`,
		);
	}
	const formula = paragraphs.find(
		element => element.getElementsByTagName('m:oMathPara').length > 0,
	);
	assert.ok(formula);
	assert.equal(
		formula
			.getElementsByTagNameNS(namespace, 'pStyle')[0]
			?.getAttributeNS(namespace, 'val'),
		'Formula',
	);
	assert.ok(
		paragraphs.some(
			paragraph =>
				paragraph
					.getElementsByTagNameNS(namespace, 'pStyle')[0]
					?.getAttributeNS(namespace, 'val') === 'Figure',
		),
		'Image-only paragraph must use Figure, not the figure caption style',
	);
	console.log(
		'Template style application passed: all 79 definitions, dependencies, names, numbering and semantic paragraph assignments.',
	);
}

void main();
