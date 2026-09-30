import assert from 'node:assert/strict';
import path from 'node:path';

import { parseMarkdownToDocx } from '@/features/markdown-parser';

interface EntityParserHarness {
	tempRoot: string;
	packAndReadXml: (
		children: Awaited<ReturnType<typeof parseMarkdownToDocx>>,
		outputPath: string,
	) => Promise<{ documentXml: string; numberingXml: string }>;
	getWordText: (xml: string) => string;
}

export async function runEntityParserTests({
	tempRoot,
	packAndReadXml,
	getWordText,
}: EntityParserHarness): Promise<void> {
	const entityElements = await parseMarkdownToDocx(
		'Entities: &#65; &#x41; &#x1F600; &amp;#65; &#38;lt; &#38;#39; &lt;tag&gt; &#91;@missing&#93;. Code: `&#65; &#x41;`.',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: entityXml } = await packAndReadXml(
		entityElements,
		path.join(tempRoot, 'numeric-entities.docx'),
	);
	assert.equal(
		getWordText(entityXml),
		'Entities: A A 😀 &#65; &lt; &#39; <tag> [@missing]. Code: &#65; &#x41;.',
	);
	const breakElements = await parseMarkdownToDocx(
		'Literal: &#x3C;br&#x3E; &lt;br&gt;. Real<br>break.',
		{},
		{ sourceDir: tempRoot },
	);
	const { documentXml: breakXml } = await packAndReadXml(
		breakElements,
		path.join(tempRoot, 'entity-breaks.docx'),
	);
	assert.equal(getWordText(breakXml), 'Literal: <br> <br>. Realbreak.');
	assert.equal([...breakXml.matchAll(/<w:br\s*\/>/g)].length, 1);
}
