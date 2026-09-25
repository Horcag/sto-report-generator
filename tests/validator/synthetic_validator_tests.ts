import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { unpackDocx } from '@/shared/lib/docx-archive';

import { runSyntheticBoldTests } from './synthetic_bold_tests';
import { runSyntheticLayoutTests } from './synthetic_layout_tests';
import { runWordNormalizedStyleTests } from './synthetic_word_style_tests';

interface ValidatorCheck {
	passed: boolean;
	error?: string;
}

export type WriteXmlFixture = (
	name: string,
	documentXml: string,
	stylesXml: string,
	extraFiles?: Record<string, string>,
) => string;
export type GetCheck = (unpackedDir: string, check: string) => ValidatorCheck;

export function runSyntheticValidatorTests(
	writeXmlFixture: WriteXmlFixture,
	getCheck: GetCheck,
): void {
	const namespaces =
		'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
	const bodyStyles = `<w:styles ${namespaces}><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style></w:styles>`;
	const bodyParagraph =
		'<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Обычный текст</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr><w:t>код</w:t></w:r></w:p>';
	const directFormattingCases = [
		'<w:jc w:val="left"/>',
		'<w:jc w:val="center"/>',
		'<w:ind w:left="1" w:firstLine="709"/>',
		'<w:ind w:right="1" w:firstLine="709"/>',
		'<w:ind w:firstLine="708"/>',
		'<w:spacing w:line="359" w:lineRule="auto"/>',
		'<w:spacing w:after="1"/>',
		'<w:ind w:left="567" w:firstLine="709"/>',
		'<w:ind w:right="567" w:firstLine="709"/>',
		'<w:ind w:firstLine="0"/>',
		'<w:spacing w:line="240" w:lineRule="auto"/>',
		'<w:spacing w:after="480"/>',
	];
	const normalFixture = writeXmlFixture(
		'direct-formatting-baseline',
		`<w:document ${namespaces}><w:body>${bodyParagraph}</w:body></w:document>`,
		bodyStyles,
	);
	assert.equal(
		getCheck(normalFixture, 'Direct Body Paragraph Formatting').passed,
		true,
	);
	runSyntheticBoldTests(writeXmlFixture, getCheck, namespaces, bodyStyles);
	assert.equal(getCheck(normalFixture, 'Math XML Elements').passed, true);
	const invalidMathFixture = writeXmlFixture(
		'invalid-math-element',
		`<w:document ${namespaces} xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><m:oMath><m:r><undefined><m:rPr><m:nor/></m:rPr></undefined><m:t>x</m:t></m:r></m:oMath></w:p></w:body></w:document>`,
		bodyStyles,
	);
	assert.equal(
		getCheck(invalidMathFixture, 'Math XML Elements').passed,
		false,
	);
	const cascadeStyles = `<w:styles ${namespaces}><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Normal"/><w:basedOn w:val="Base"/></w:style></w:styles>`;
	const cascadeParagraph = bodyParagraph.replace(
		'w:val="Normal"',
		'w:val="Body"',
	);
	const cascadeCase = (
		name: string,
		paragraph: string,
		styles: string,
		expected: boolean,
		numbering?: string,
	) => {
		const fixture = writeXmlFixture(
			name,
			`<w:document ${namespaces}><w:body>${paragraph}</w:body></w:document>`,
			styles,
			numbering ? { 'word/numbering.xml': numbering } : undefined,
		);
		assert.equal(
			getCheck(fixture, 'Direct Body Paragraph Formatting').passed,
			expected,
			name,
		);
	};
	cascadeCase(
		'cascade-valid-style-chain',
		cascadeParagraph,
		cascadeStyles,
		true,
	);
	cascadeCase(
		'cascade-bad-default',
		cascadeParagraph,
		cascadeStyles.replace('w:line="360"', 'w:line="240"'),
		false,
	);
	cascadeCase(
		'cascade-bad-base-style',
		cascadeParagraph,
		cascadeStyles.replace('w:after="0"', 'w:after="120"'),
		false,
	);
	cascadeCase(
		'cascade-bad-body-style',
		cascadeParagraph,
		cascadeStyles.replace(
			'<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Normal"/><w:basedOn w:val="Base"/>',
			'<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Normal"/><w:basedOn w:val="Base"/><w:pPr><w:jc w:val="center"/></w:pPr>',
		),
		false,
	);
	cascadeCase(
		'cascade-direct-restores-style',
		cascadeParagraph.replace(
			'</w:pPr>',
			'<w:spacing w:after="0"/></w:pPr>',
		),
		cascadeStyles.replace('w:after="0"', 'w:after="120"'),
		true,
	);
	cascadeCase(
		'cascade-direct-first-line-cancels-hanging',
		cascadeParagraph.replace(
			'</w:pPr>',
			'<w:ind w:firstLine="709"/></w:pPr>',
		),
		cascadeStyles.replace('w:firstLine="709"', 'w:hanging="360"'),
		true,
	);
	cascadeCase(
		'cascade-inherited-hanging',
		cascadeParagraph,
		cascadeStyles.replace('w:firstLine="709"', 'w:hanging="360"'),
		false,
	);
	cascadeCase(
		'cascade-child-hanging-overrides-base-first-line',
		cascadeParagraph,
		cascadeStyles.replace(
			'<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Normal"/><w:basedOn w:val="Base"/>',
			'<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Normal"/><w:basedOn w:val="Base"/><w:pPr><w:ind w:hanging="360"/></w:pPr>',
		),
		false,
	);
	const numberedStyles = cascadeStyles.replace(
		'<w:basedOn w:val="Base"/></w:style>',
		'<w:basedOn w:val="Base"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style>',
	);
	const numbering = `<w:numbering ${namespaces}><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:pPr><w:spacing w:after="120"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
	cascadeCase(
		'cascade-bad-numbering',
		cascadeParagraph,
		numberedStyles,
		false,
		numbering,
	);
	cascadeCase(
		'cascade-direct-restores-numbering',
		cascadeParagraph.replace(
			'</w:pPr>',
			'<w:spacing w:after="0"/></w:pPr>',
		),
		numberedStyles,
		true,
		numbering,
	);
	cascadeCase(
		'cascade-bad-numbering-override',
		cascadeParagraph,
		numberedStyles,
		false,
		numbering
			.replace(
				'<w:abstractNumId w:val="2"/>',
				'<w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:pPr><w:jc w:val="center"/></w:pPr></w:lvl></w:lvlOverride>',
			)
			.replace('<w:spacing w:after="120"/>', '<w:spacing w:after="0"/>'),
	);
	const archiveDir = path.join(
		process.cwd(),
		'.agent-work',
		'validator-ppr-docx',
	);
	fs.mkdirSync(archiveDir, { recursive: true });
	const baseArchive = new AdmZip();
	baseArchive.addFile(
		'[Content_Types].xml',
		Buffer.from(
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
		),
	);
	baseArchive.addFile(
		'word/document.xml',
		Buffer.from(
			`<w:document ${namespaces}><w:body>${cascadeParagraph}</w:body></w:document>`,
		),
	);
	baseArchive.addFile('word/styles.xml', Buffer.from(cascadeStyles));
	for (const [name, entry, from, to, expected] of [
		['baseline', '', '', '', true],
		[
			'direct-override',
			'word/document.xml',
			'<w:pStyle w:val="Body"/>',
			'<w:pStyle w:val="Body"/><w:jc w:val="left"/>',
			false,
		],
		[
			'inherited-override',
			'word/styles.xml',
			'<w:spacing w:after="0"/>',
			'<w:spacing w:after="120"/>',
			false,
		],
	] as const) {
		const archive = new AdmZip(baseArchive.toBuffer());
		if (entry) {
			const archiveEntry = archive.getEntry(entry);
			assert.ok(archiveEntry);
			const source = archiveEntry.getData().toString('utf8');
			assert.ok(source.includes(from));
			archive.updateFile(entry, Buffer.from(source.replace(from, to)));
		}
		const docxPath = path.join(archiveDir, `${name}.docx`);
		archive.writeZip(docxPath);
		const unpacked = path.join(archiveDir, `${name}-unpacked`);
		unpackDocx(docxPath, unpacked);
		assert.equal(
			getCheck(unpacked, 'Direct Body Paragraph Formatting').passed,
			expected,
			`DOCX mutation: ${name}`,
		);
	}
	const implicitNormalFixture = writeXmlFixture(
		'direct-formatting-implicit-normal',
		`<w:document ${namespaces}><w:body>${bodyParagraph.replace('<w:pStyle w:val="Normal"/>', '').replace('</w:pPr>', '<w:ind w:firstLine="708"/></w:pPr>')}</w:body></w:document>`,
		bodyStyles,
	);
	assert.equal(
		getCheck(implicitNormalFixture, 'Direct Body Paragraph Formatting')
			.passed,
		false,
	);
	for (const [index, property] of directFormattingCases.entries()) {
		const mutated = bodyParagraph.replace(
			'</w:pPr>',
			`${property}</w:pPr>`,
		);
		const fixture = writeXmlFixture(
			`direct-formatting-${index}`,
			`<w:document ${namespaces}><w:body>${mutated}</w:body></w:document>`,
			bodyStyles,
		);
		assert.equal(
			getCheck(fixture, 'Direct Body Paragraph Formatting').passed,
			false,
			property,
		);
	}
	const wordStyleFixture = writeXmlFixture(
		'word-normalized-body-style',
		`<w:document ${namespaces}><w:body>${bodyParagraph.replace('w:val="Normal"', 'w:val="1-"').replace('</w:pPr>', '<w:ind w:firstLine="708"/></w:pPr>')}</w:body></w:document>`,
		bodyStyles
			.replace('w:styleId="Normal"', 'w:styleId="1-"')
			.replace('w:val="Normal"', 'w:val="+Абзац с отступом 1-ой строки"'),
	);
	assert.equal(
		getCheck(wordStyleFixture, 'Direct Body Paragraph Formatting').passed,
		false,
	);
	const exceptionFixture = writeXmlFixture(
		'direct-formatting-exceptions',
		`<w:document ${namespaces}><w:body>
			<w:p><w:pPr><w:pStyle w:val="TitlePageText"/><w:ind w:left="567"/></w:pPr><w:r><w:t>Титул</w:t></w:r></w:p>
			<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:numId w:val="1"/></w:numPr><w:ind w:left="567"/></w:pPr><w:r><w:t>Перечень</w:t></w:r></w:p>
			<w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:line="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr><w:t>код</w:t></w:r></w:p>
			<w:p><w:pPr><w:pStyle w:val="Normal"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:t>где x – переменная.</w:t></w:r></w:p>
			<w:tbl><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="Normal"/><w:ind w:left="567"/></w:pPr><w:r><w:t>Ячейка</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
		</w:body></w:document>`,
		bodyStyles,
	);
	assert.equal(
		getCheck(exceptionFixture, 'Direct Body Paragraph Formatting').passed,
		true,
	);
	const runSpacingFixture = writeXmlFixture(
		'direct-run-spacing',
		`<w:document ${namespaces}><w:body><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:spacing w:val="20"/></w:rPr><w:t>Текст</w:t></w:r></w:p></w:body></w:document>`,
		bodyStyles,
	);
	assert.equal(
		getCheck(runSpacingFixture, 'Direct Body Paragraph Formatting').passed,
		false,
	);
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

	const bibliographyTabNumberingFixture = writeXmlFixture(
		'bibliography-tab-numbering',
		`<w:document ${namespaces}><w:body/></w:document>`,
		`<w:styles ${namespaces}/>`,
		{
			'word/numbering.xml': `<w:numbering ${namespaces}>
				<w:abstractNum w:abstractNumId="0">
					<w:lvl w:ilvl="0">
						<w:numFmt w:val="decimal"/>
						<w:lvlText w:val="%1"/>
						<w:suff w:val="tab"/>
						<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
					</w:lvl>
				</w:abstractNum>
			</w:numbering>`,
		},
	);
	assert.equal(
		getCheck(
			bibliographyTabNumberingFixture,
			'Bibliography Numbering Indent & Format',
		).passed,
		true,
	);

	const bibliographySpaceNumberingFixture = writeXmlFixture(
		'bibliography-space-numbering',
		`<w:document ${namespaces}><w:body/></w:document>`,
		`<w:styles ${namespaces}/>`,
		{
			'word/numbering.xml': `<w:numbering ${namespaces}>
				<w:abstractNum w:abstractNumId="0">
					<w:lvl w:ilvl="0">
						<w:numFmt w:val="decimal"/>
						<w:lvlText w:val="%1"/>
						<w:suff w:val="space"/>
						<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
					</w:lvl>
				</w:abstractNum>
			</w:numbering>`,
		},
	);
	assert.equal(
		getCheck(
			bibliographySpaceNumberingFixture,
			'Bibliography Numbering Indent & Format',
		).passed,
		false,
	);

	runSyntheticLayoutTests(writeXmlFixture, getCheck, namespaces);
	runWordNormalizedStyleTests(writeXmlFixture, getCheck, namespaces);

	console.log('Synthetic validator regression tests passed.\n');
}
