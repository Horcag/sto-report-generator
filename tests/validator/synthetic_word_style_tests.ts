import assert from 'node:assert/strict';

import type { GetCheck, WriteXmlFixture } from './synthetic_validator_tests';

export function runWordNormalizedStyleTests(
	writeXmlFixture: WriteXmlFixture,
	getCheck: GetCheck,
	namespaces: string,
): void {
	const documentXml = `<w:document ${namespaces}><w:body>
		<w:p><w:pPr><w:pStyle w:val="ad"/></w:pPr><w:r><w:t>РЕФЕРАТ</w:t></w:r></w:p>
		<w:p><w:pPr><w:pStyle w:val="-0"/></w:pPr><w:r><w:t>Таблица 1 – Данные</w:t></w:r></w:p>
		<w:tbl><w:tr><w:tblHeader/><w:tc><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
		<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing/></w:r></w:p>
		<w:p><w:pPr><w:pStyle w:val="-"/></w:pPr><w:r><w:t>Рисунок 1 – Данные</w:t></w:r></w:p>
	</w:body></w:document>`;
	const stylesXml = `<w:styles ${namespaces}>
		<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="28"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
		<w:style w:type="paragraph" w:styleId="1-"><w:name w:val="+Абзац с отступом 1-ой строки"/><w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="ae"><w:name w:val="+Тит_Абзац по центру"/><w:basedOn w:val="1-"/><w:pPr><w:spacing w:line="240"/><w:jc w:val="center"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="ac"><w:name w:val="+ЗАГОЛОВОК по центру"/><w:basedOn w:val="1-"/><w:pPr><w:pageBreakBefore/><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:caps/></w:rPr></w:style>
		<w:style w:type="paragraph" w:styleId="ad"><w:name w:val="+ЗаголРеферСодерж"/><w:basedOn w:val="ae"/><w:pPr><w:pageBreakBefore/><w:spacing w:after="240"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="1"><w:name w:val="+Заголовок 1 уровня"/><w:basedOn w:val="1-"/><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:numPr><w:numId w:val="11"/></w:numPr><w:spacing w:after="120"/><w:jc w:val="left"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="-0"><w:name w:val="+№ - Название таблицы"/><w:basedOn w:val="1-"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="120" w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="-"><w:name w:val="+№ - Название рисунка"/><w:basedOn w:val="1-"/><w:pPr><w:keepLines/><w:spacing w:before="120" w:after="240" w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>
		<w:style w:type="paragraph" w:styleId="af"><w:name w:val="+Текст в таблице"/><w:basedOn w:val="1-"/><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
	</w:styles>`;
	const numberingXml = `<w:numbering ${namespaces}>
		<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:pStyle w:val="1"/><w:pPr><w:ind w:left="0" w:firstLine="709"/></w:pPr></w:lvl></w:abstractNum>
		<w:num w:numId="11"><w:abstractNumId w:val="1"/></w:num>
	</w:numbering>`;
	const fixture = (
		name: string,
		styleContent = stylesXml,
		numberingContent = numberingXml,
	) =>
		writeXmlFixture(name, documentXml, styleContent, {
			'word/numbering.xml': numberingContent,
		});
	const accepted = fixture('word-normalized-styles');
	for (const check of [
		'Normal Paragraph Indent & Alignment',
		'Table Caption Adjacency',
		'Figure Caption Adjacency',
		'Numbered Heading Template Style',
		'Numbered Heading Effective Indent',
		'Structural Heading Alignment',
		'Structural Heading Spacing',
		'Title Page Base Style',
		'Figure Caption Style',
		'Table Caption Style',
		'Table Text Style',
	]) {
		assert.equal(getCheck(accepted, check).passed, true, check);
	}
	assert.equal(
		getCheck(
			fixture(
				'word-normalized-wrong-indent',
				stylesXml.replace('w:firstLine="709"', 'w:firstLine="708"'),
			),
			'Normal Paragraph Indent & Alignment',
		).passed,
		false,
	);
	assert.equal(
		getCheck(
			fixture(
				'word-normalized-wrong-caption',
				stylesXml.replace(
					'w:before="120" w:after="120"',
					'w:before="120" w:after="200"',
				),
			),
			'Table Caption Style',
		).passed,
		false,
	);
	assert.equal(
		getCheck(
			fixture(
				'word-normalized-wrong-numbering',
				stylesXml,
				numberingXml.replace(
					'w:left="0" w:firstLine="709"',
					'w:left="0" w:firstLine="708"',
				),
			),
			'Numbered Heading Effective Indent',
		).passed,
		false,
	);
}
