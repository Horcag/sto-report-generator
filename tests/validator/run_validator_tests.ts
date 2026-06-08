import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { unpackDocx } from '@/shared/lib/docx-archive';
import { validateSTO } from '@/shared/lib/sto-validator';

const brokenDir = path.join(__dirname, '..', 'fixtures', 'validator', 'broken');
const tempRoot = path.join(process.cwd(), '.agent-work', 'validator-tests');

function normalizeOutput(output: string): string[] {
	return output
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.sort((left, right) => left.localeCompare(right));
}

function formatValidatorOutput(unpackedDir: string): string {
	return validateSTO(unpackedDir)
		.filter(result => !result.passed)
		.map(result => `${result.check}: ${result.error ?? 'failed'}`)
		.join('\n');
}

function expectedPathFor(docxFile: string): string | null {
	const expectedPath = path.join(
		brokenDir,
		docxFile.replace('.docx', '.expected.txt'),
	);
	const fallbackExpectedPath = path.join(brokenDir, 'broken.expected.txt');
	if (fs.existsSync(expectedPath)) {
		return expectedPath;
	}
	return fs.existsSync(fallbackExpectedPath) ? fallbackExpectedPath : null;
}

function compareWithExpected(file: string, actualOutput: string): boolean {
	const finalExpectedPath = expectedPathFor(file);
	if (!finalExpectedPath) {
		console.log(`Warning: No expected.txt found for ${file}.`);
		console.log('Actual output was:');
		console.log(actualOutput);
		return true;
	}

	const expectedOutput = fs.readFileSync(finalExpectedPath, 'utf-8').trim();
	const actualLines = normalizeOutput(actualOutput);
	const expectedLines = normalizeOutput(expectedOutput);
	const isMatch =
		actualLines.length === expectedLines.length &&
		actualLines.every((line, index) => line === expectedLines[index]);

	if (!isMatch) {
		console.log(`\nExpected Output (${expectedLines.length} errors):`);
		console.log(expectedLines.join('\n'));
		console.log(`\nActual Output (${actualLines.length} errors):`);
		console.log(actualLines.join('\n'));
		console.log('\n---\n');
	}
	return isMatch;
}

function writeXmlFixture(
	name: string,
	documentXml: string,
	stylesXml: string,
	extraFiles: Record<string, string> = {},
): string {
	const fixtureDir = path.join(tempRoot, name, 'word');
	fs.rmSync(path.dirname(fixtureDir), { recursive: true, force: true });
	fs.mkdirSync(fixtureDir, { recursive: true });
	fs.writeFileSync(
		path.join(fixtureDir, 'document.xml'),
		documentXml,
		'utf-8',
	);
	fs.writeFileSync(path.join(fixtureDir, 'styles.xml'), stylesXml, 'utf-8');
	for (const [relativePath, content] of Object.entries(extraFiles)) {
		const filePath = path.join(path.dirname(fixtureDir), relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, 'utf-8');
	}
	return path.dirname(fixtureDir);
}

function getCheck(unpackedDir: string, check: string) {
	const result = validateSTO(unpackedDir).find(item => item.check === check);
	assert.ok(result, `Validation check not found: ${check}`);
	return result;
}

function runSyntheticValidatorTests(): void {
	const namespaces =
		'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
	const layoutTabFixture = writeXmlFixture(
		'layout-tabs',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:pStyle w:val="TitlePageText"/></w:pPr><w:r><w:tab/></w:r><w:r><w:t>Титульный лист</w:t></w:r></w:p>
			<w:p><w:pPr><w:pStyle w:val="11"/></w:pPr><w:r><w:t>Введение</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>7</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}>
			<w:style w:type="paragraph" w:styleId="TitlePageText"><w:name w:val="Title Page Text"/></w:style>
			<w:style w:type="paragraph" w:styleId="11"><w:name w:val="toc 1"/></w:style>
		</w:styles>`,
	);
	assert.equal(getCheck(layoutTabFixture, 'Tab Characters').passed, true);

	const bodyTabFixture = writeXmlFixture(
		'body-tabs',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Текст</w:t></w:r><w:r><w:tab/></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
	);
	assert.equal(getCheck(bodyTabFixture, 'Tab Characters').passed, false);

	const inheritedPageBreakFixture = writeXmlFixture(
		'inherited-page-breaks',
		`<w:document ${namespaces}><w:body/></w:document>`,
		`<w:styles ${namespaces}>
			<w:style w:type="paragraph" w:styleId="STOHeading1"><w:name w:val="STO Heading 1"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>
			<w:style w:type="paragraph" w:styleId="StructuralHeading"><w:name w:val="Structural Heading"/><w:basedOn w:val="STOHeading1"/></w:style>
			<w:style w:type="paragraph" w:styleId="StructuralHeadingNoTOC"><w:name w:val="Structural Heading No TOC"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>
		</w:styles>`,
	);
	assert.equal(
		getCheck(inheritedPageBreakFixture, 'Heading 1 Page Break').passed,
		true,
	);
	assert.equal(
		getCheck(inheritedPageBreakFixture, 'Structural Heading Page Break')
			.passed,
		true,
	);

	const unresolvedCitationFixture = writeXmlFixture(
		'unresolved-citation',
		`<w:document ${namespaces}><w:body>
			<w:p><w:r><w:t>Текст с [@smith2020]</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(unresolvedCitationFixture, 'Citation Formatting').passed,
		false,
	);

	const denseCitationFixture = writeXmlFixture(
		'dense-citations',
		`<w:document ${namespaces}><w:body>
			<w:p><w:r><w:t>Источник [1], затем [1, 2] и [3]</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	assert.equal(
		getCheck(denseCitationFixture, 'Citation Number Sequence').passed,
		true,
	);

	const sparseCitationFixture = writeXmlFixture(
		'sparse-citations',
		`<w:document ${namespaces}><w:body>
			<w:p><w:r><w:t>Источник [1], затем [3]</w:t></w:r></w:p>
		</w:body></w:document>`,
		`<w:styles ${namespaces}/>`,
	);
	const sparseCitationCheck = getCheck(
		sparseCitationFixture,
		'Citation Number Sequence',
	);
	assert.equal(sparseCitationCheck.passed, false);
	assert.match(sparseCitationCheck.error ?? '', /2/);

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
			'word/footer2.xml': `<w:ftr ${namespaces}><w:p><w:r><w:t></w:t></w:r></w:p></w:ftr>`,
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
		`<w:styles ${namespaces}/>`,
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
		`<w:styles ${namespaces}/>`,
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

	console.log('Synthetic validator regression tests passed.\n');
}

function runTests(): void {
	console.log('Running STO Validator E2E Tests...\n');
	runSyntheticValidatorTests();
	let passed = 0;
	let failed = 0;

	if (!fs.existsSync(brokenDir)) {
		console.log(`Directory ${brokenDir} does not exist. Skipping tests.`);
		return;
	}

	fs.mkdirSync(tempRoot, { recursive: true });
	const docxFiles = fs
		.readdirSync(brokenDir)
		.filter(file => file.endsWith('.docx') && !file.startsWith('~$'))
		.sort((left, right) => left.localeCompare(right));

	if (docxFiles.length === 0) {
		throw new Error('No broken .docx files found to test.');
	}

	for (const file of docxFiles) {
		console.log(`Testing: ${file}`);
		const docxPath = path.join(brokenDir, file);
		const unpackedDir = path.join(tempRoot, path.basename(file, '.docx'));
		unpackDocx(docxPath, unpackedDir);
		const actualOutput = formatValidatorOutput(unpackedDir).trim();

		if (compareWithExpected(file, actualOutput)) {
			console.log('PASSED\n');
			passed++;
		} else {
			console.log('FAILED\n');
			failed++;
		}
	}

	console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
	if (failed > 0) {
		process.exit(1);
	}
}

runTests();
