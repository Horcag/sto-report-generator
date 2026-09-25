import assert from 'node:assert/strict';

import type { GetCheck, WriteXmlFixture } from './synthetic_validator_tests';

export function runSyntheticLayoutTests(
	writeXmlFixture: WriteXmlFixture,
	getCheck: GetCheck,
	namespaces: string,
): void {
	const tableStyles = `<w:styles ${namespaces}><w:style w:type="paragraph" w:styleId="TableCaption"><w:name w:val="Table Caption"/></w:style></w:styles>`;
	const caption = (value: string, alignment = '') =>
		`<w:p><w:pPr><w:pStyle w:val="TableCaption"/>${alignment}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
	const table = (border = '') =>
		`<w:tbl><w:tblPr><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Поле</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
	const continuationFixture = writeXmlFixture(
		'table-continuation',
		`<w:document ${namespaces}><w:body>${caption('Таблица 1 – Данные')}${table()}${caption('Продолжение таблицы 1')}${table()}</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(
		getCheck(continuationFixture, 'Table Continuation Label').passed,
		true,
	);
	assert.equal(
		getCheck(continuationFixture, 'Table Continuation Bottom Border')
			.passed,
		true,
	);
	assert.equal(
		getCheck(continuationFixture, 'Table Caption Adjacency').passed,
		true,
	);
	const badContinuationFixture = writeXmlFixture(
		'bad-table-continuation',
		`<w:document ${namespaces}><w:body>${caption('Таблица 1 – Данные')}${table('<w:bottom w:val="single"/>')}${caption('Продолжение таблицы 2.', '<w:jc w:val="center"/>')}${table()}</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(
		getCheck(badContinuationFixture, 'Table Continuation Label').passed,
		false,
	);
	assert.equal(
		getCheck(badContinuationFixture, 'Table Continuation Bottom Border')
			.passed,
		false,
	);
	const separatedContinuationFixture = writeXmlFixture(
		'separated-table-continuation',
		`<w:document ${namespaces}><w:body>${caption('Таблица 1 – Данные')}${table()}<w:p><w:r><w:t>Посторонний текст</w:t></w:r></w:p>${caption('Продолжение таблицы 1')}${table()}</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(
		getCheck(separatedContinuationFixture, 'Table Continuation Label')
			.passed,
		false,
	);

	const noteFixture = writeXmlFixture(
		'notes',
		`<w:document ${namespaces}><w:body>
		<w:p><w:r><w:t>Описание.</w:t></w:r></w:p>
		<w:p><w:r><w:t>Примечание – уточнение.</w:t></w:r></w:p>
		${table()}
		<w:p><w:r><w:t>Примечания</w:t></w:r></w:p>
		<w:p><w:r><w:t>1 Первый пункт.</w:t></w:r></w:p>
		<w:p><w:r><w:t>2 Второй пункт.</w:t></w:r></w:p>
		</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(getCheck(noteFixture, 'Note Placement').passed, true);
	assert.equal(getCheck(noteFixture, 'Note Form').passed, true);
	assert.equal(getCheck(noteFixture, 'Table Note End').passed, true);
	const badNoteFixture = writeXmlFixture(
		'bad-notes',
		`<w:document ${namespaces}><w:body>
		<w:p><w:r><w:t>Примечание: неверно.</w:t></w:r></w:p>
		<w:p><w:r><w:t>Примечания</w:t></w:r></w:p>
		<w:p><w:r><w:t>2 Только второй пункт.</w:t></w:r></w:p>
		</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(getCheck(badNoteFixture, 'Note Placement').passed, false);
	assert.equal(getCheck(badNoteFixture, 'Note Form').passed, false);
	const earlyTableNoteFixture = writeXmlFixture(
		'early-table-note',
		`<w:document ${namespaces}><w:body>${caption('Таблица 1 – Данные')}${table()}<w:p><w:r><w:t>Примечание – к таблице.</w:t></w:r></w:p>${caption('Продолжение таблицы 1')}${table()}</w:body></w:document>`,
		tableStyles,
	);
	assert.equal(
		getCheck(earlyTableNoteFixture, 'Table Note End').passed,
		false,
	);
	const tableHeaderPeriodFixture = writeXmlFixture(
		'table-header-period',
		`<w:document ${namespaces}><w:body>
			<w:tbl>
				<w:tr><w:tc><w:p><w:r><w:t>Показатель.</w:t></w:r></w:p></w:tc></w:tr>
				<w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr>
			</w:tbl>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(tableHeaderPeriodFixture, 'Table Header Final Period').passed,
		false,
	);

	const pageNumberingFixture = writeXmlFixture(
		'page-numbering',
		`<w:document ${namespaces} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
			<w:sectPr><w:footerReference w:type="default" r:id="rId1"/><w:footerReference w:type="first" r:id="rId2"/><w:titlePg/></w:sectPr>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
		{
			'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
				<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
				<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
			</Relationships>`,
			'word/footer1.xml': `<w:ftr ${namespaces}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:ftr>`,
			'word/footer2.xml': `<w:ftr ${namespaces}><w:p><w:r><w:t>Самара 2026</w:t></w:r></w:p></w:ftr>`,
		},
	);
	assert.equal(
		getCheck(pageNumberingFixture, 'Page Number Footer').passed,
		true,
	);
	assert.equal(
		getCheck(pageNumberingFixture, 'Title Page Number Hidden').passed,
		true,
	);

	const visibleTitlePageNumberFixture = writeXmlFixture(
		'visible-title-page-number',
		`<w:document ${namespaces} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
			<w:sectPr><w:footerReference w:type="default" r:id="rId1"/><w:footerReference w:type="first" r:id="rId2"/><w:titlePg/></w:sectPr>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
		{
			'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
				<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
				<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
			</Relationships>`,
			'word/footer1.xml': `<w:ftr ${namespaces}><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:ftr>`,
			'word/footer2.xml': `<w:ftr ${namespaces}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:ftr>`,
		},
	);
	assert.equal(
		getCheck(visibleTitlePageNumberFixture, 'Page Number Footer').passed,
		false,
	);
	assert.equal(
		getCheck(visibleTitlePageNumberFixture, 'Title Page Number Hidden')
			.passed,
		false,
	);

	const titlePageWithoutFirstFooterFixture = writeXmlFixture(
		'title-page-without-first-footer',
		`<w:document ${namespaces} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
			<w:sectPr><w:footerReference w:type="default" r:id="rId1"/><w:titlePg/></w:sectPr>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
		{
			'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
				<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
			</Relationships>`,
			'word/footer1.xml': `<w:ftr ${namespaces}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:ftr>`,
		},
	);
	assert.equal(
		getCheck(titlePageWithoutFirstFooterFixture, 'Title Page Number Hidden')
			.passed,
		true,
	);

	const normalStyleFixture = writeXmlFixture(
		'normal-style',
		`<w:document ${namespaces}><w:body/></w:document>`,
		`<w:styles ${namespaces}>
			<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/></w:pPr></w:style>
		</w:styles>`,
	);
	assert.equal(
		getCheck(normalStyleFixture, 'Normal Paragraph Indent & Alignment')
			.passed,
		false,
	);

	const wordNormalizedNormalStyleFixture = writeXmlFixture(
		'word-normalized-normal-style',
		`<w:document ${namespaces}><w:body/></w:document>`,
		`<w:styles ${namespaces}>
			<w:docDefaults><w:pPrDefault><w:pPr><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
			<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style>
		</w:styles>`,
	);
	assert.equal(
		getCheck(
			wordNormalizedNormalStyleFixture,
			'Normal Paragraph Indent & Alignment',
		).passed,
		true,
	);

	const sectionMarginsFixture = writeXmlFixture(
		'section-margins',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:sectPr><w:pgMar w:top="1134" w:bottom="1134" w:left="1701" w:right="850"/></w:sectPr></w:pPr></w:p>
			<w:sectPr><w:pgMar w:top="1000" w:bottom="1134" w:left="1701" w:right="850"/></w:sectPr>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(getCheck(sectionMarginsFixture, 'Page Margins').passed, false);

	const tableCaptionAdjacencyFixture = writeXmlFixture(
		'table-caption-adjacency',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:pStyle w:val="TableCaption"/></w:pPr><w:r><w:t>Таблица 1 – Корректная</w:t></w:r></w:p>
			<w:tbl><w:tr><w:tblHeader/><w:tc><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
		</w:body></w:document>`,
		`<w:styles ${namespaces}><w:style w:type="paragraph" w:styleId="TableCaption"><w:name w:val="Table Caption"/></w:style></w:styles>`,
	);
	assert.equal(
		getCheck(tableCaptionAdjacencyFixture, 'Table Caption Adjacency')
			.passed,
		true,
	);

	const tableWithoutCaptionFixture = writeXmlFixture(
		'table-without-caption',
		`<w:document ${namespaces}><w:body>
			<w:p><w:r><w:t>Обычный текст</w:t></w:r></w:p>
			<w:tbl><w:tr><w:tblHeader/><w:tc><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(tableWithoutCaptionFixture, 'Table Caption Adjacency').passed,
		false,
	);

	const frontMatterTableFixture = writeXmlFixture(
		'front-matter-table',
		`<w:document ${namespaces}><w:body>
			<w:p><w:r><w:t>Титульный лист</w:t></w:r></w:p>
			<w:tbl>
				<w:tr><w:tc><w:p><w:r><w:t>Показатель.</w:t></w:r></w:p></w:tc></w:tr>
				<w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr>
			</w:tbl>
			<w:p><w:pPr><w:pStyle w:val="StructuralHeadingNoTOC"/></w:pPr><w:r><w:t>РЕФЕРАТ</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(frontMatterTableFixture, 'Table Header Final Period').passed,
		true,
	);
	assert.equal(
		getCheck(frontMatterTableFixture, 'Table Caption Adjacency').passed,
		true,
	);

	const diagonalBorderFixture = writeXmlFixture(
		'diagonal-table-border',
		`<w:document ${namespaces}><w:body>
			<w:tbl><w:tr><w:tblHeader/><w:tc><w:tcPr><w:tcBorders><w:tl2br w:val="single"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>Заголовок</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Значение</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(diagonalBorderFixture, 'Table Diagonal Borders').passed,
		false,
	);

	const figureCaptionAdjacencyFixture = writeXmlFixture(
		'figure-caption-adjacency',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing/></w:r></w:p>
			<w:p><w:pPr><w:pStyle w:val="FigureCaption"/></w:pPr><w:r><w:t>Рисунок 1 – Корректный</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}><w:style w:type="paragraph" w:styleId="FigureCaption"><w:name w:val="Figure Caption"/></w:style></w:styles>`,
	);
	assert.equal(
		getCheck(figureCaptionAdjacencyFixture, 'Figure Caption Adjacency')
			.passed,
		true,
	);

	const figureWithoutCaptionFixture = writeXmlFixture(
		'figure-without-caption',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing/></w:r></w:p>
			<w:p><w:r><w:t>Обычный текст</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(figureWithoutCaptionFixture, 'Figure Caption Adjacency')
			.passed,
		false,
	);
}
