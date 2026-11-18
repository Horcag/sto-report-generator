import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateTemplateStyleConformance } from '@/shared/lib/sto-template-style-validator';
import { validateSTO } from '@/shared/lib/sto-validator';
import { extractWordText } from '@/shared/lib/sto-validator/body-xml';

const W =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const WP =
	'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const MC =
	'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const WPG =
	'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const WPS =
	'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const V = 'xmlns:v="urn:schemas-microsoft-com:vml"';

const BASE_STYLES = `<w:styles ${W}>
	<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
	<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="709"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/></w:rPr></w:style>
	<w:style w:type="paragraph" w:styleId="STOHeading1"><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="0" w:after="120" w:line="360"/><w:ind w:firstLine="709"/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="StructuralHeading"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120" w:line="360"/><w:jc w:val="center"/><w:pageBreakBefore/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="TitlePageText"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>
	<w:style w:type="paragraph" w:styleId="StructuralHeadingNoTOC"><w:basedOn w:val="TitlePageText"/><w:pPr><w:spacing w:before="0" w:after="240" w:line="240"/><w:jc w:val="center"/><w:pageBreakBefore/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="Figure"><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:line="360"/><w:keepNext/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="FigureCaption"><w:pPr><w:spacing w:before="120" w:after="240" w:line="240"/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:keepLines/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="TableCaption"><w:pPr><w:spacing w:before="120" w:after="120" w:line="240"/><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:keepNext/><w:keepLines/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="TableText"><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/></w:pPr></w:style>
	<w:style w:type="paragraph" w:styleId="DiagramText"><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
</w:styles>`;

const BASE_NUMBERING = `<w:numbering ${W}>
	<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:pPr><w:ind w:left="0" w:firstLine="709"/></w:pPr></w:lvl></w:abstractNum>
	<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function writeUnpackedFixture(
	root: string,
	name: string,
	bodyXml: string,
	stylesXml = BASE_STYLES,
): string {
	const dir = path.join(root, name);
	fs.mkdirSync(path.join(dir, 'word'), { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'word', 'document.xml'),
		`<w:document ${W} ${WP} ${A} ${MC} ${WPG} ${WPS} ${V}><w:body>${bodyXml}<w:sectPr><w:pgMar w:top="1134" w:bottom="1134" w:left="1701" w:right="567"/></w:sectPr></w:body></w:document>`,
	);
	fs.writeFileSync(path.join(dir, 'word', 'styles.xml'), stylesXml);
	fs.writeFileSync(path.join(dir, 'word', 'numbering.xml'), BASE_NUMBERING);
	return dir;
}

function checkStatus(dir: string, checkName: string): boolean {
	const found = validateSTO(dir).find(item => item.check === checkName);
	assert.ok(found, `Missing check ${checkName}`);
	return found.passed;
}

function run(): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-drawing-shapes-'));
	try {
		const shapeDrawing = `<w:r><w:drawing><wp:inline><wp:extent cx="3600000" cy="1800000"/><a:graphic><a:graphicData><wpg:wgp><wps:wsp><wps:txbx><w:txbxContent><w:p><w:pPr><w:pStyle w:val="DiagramText"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>$x$ [99]\tБЛОК</w:t></w:r><w:r><w:tab/><w:t>подпись</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
		const fallbackOversized = `<w:mc><mc:AlternateContent><mc:Choice Requires="wpg">${shapeDrawing}</mc:Choice><mc:Fallback><w:r><w:pict><v:shape/><v:textbox><w:txbxContent><w:p><w:r><w:t>FALLBACK TEXT $y$ [88]</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></w:r><w:r><w:drawing><wp:inline><wp:extent cx="99999999" cy="1800000"/></wp:inline></w:drawing></w:r></mc:Fallback></mc:AlternateContent></w:mc>`;
		const validBody =
			`<w:p><w:pPr><w:pStyle w:val="StructuralHeading"/></w:pPr><w:r><w:t>ВВЕДЕНИЕ</w:t></w:r></w:p>` +
			`<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Первый абзац текста с корректным оформлением.</w:t></w:r></w:p>` +
			`<w:p><w:pPr><w:pStyle w:val="Figure"/></w:pPr>${fallbackOversized}</w:p>` +
			`<w:p><w:pPr><w:pStyle w:val="FigureCaption"/></w:pPr><w:r><w:t>Рисунок 1 – Схема алгоритма</w:t></w:r></w:p>`;

		const cleanDir = writeUnpackedFixture(root, 'clean', validBody);
		for (const checkName of [
			'Image Paragraph Alignment',
			'Figure Caption Adjacency',
			'Image Width Limit',
			'Tab Characters',
			'Math Formatting (Unparsed)',
			'Ordinary Body Bold Text',
			'Direct Body Paragraph Formatting',
			'Empty Table Cells',
			'Table Header Final Period',
		]) {
			assert.equal(checkStatus(cleanDir, checkName), true, checkName);
		}
		assert.equal(
			extractWordText(
				`<w:p>${shapeDrawing}<w:r><w:t>OK</w:t></w:r></w:p>`,
			),
			'OK',
		);

		// Negative controls: real outer violations must still fail loudly.
		const uncenteredDir = writeUnpackedFixture(
			root,
			'uncentered',
			validBody.replace(
				'<w:pPr><w:pStyle w:val="Figure"/></w:pPr>',
				'<w:pPr><w:pStyle w:val="Normal"/></w:pPr>',
			),
		);
		assert.equal(
			checkStatus(uncenteredDir, 'Image Paragraph Alignment'),
			false,
		);

		const oversizedChoiceDir = writeUnpackedFixture(
			root,
			'oversized-choice',
			validBody.replace('cx="3600000"', 'cx="99999999"'),
		);
		assert.equal(
			checkStatus(oversizedChoiceDir, 'Image Width Limit'),
			false,
		);

		const bodyTabDir = writeUnpackedFixture(
			root,
			'body-tab',
			`${validBody}<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:tab/><w:t>Таб</w:t></w:r></w:p>`,
		);
		assert.equal(checkStatus(bodyTabDir, 'Tab Characters'), false);

		const bodyMathDir = writeUnpackedFixture(
			root,
			'body-math',
			`${validBody}<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Формула $x$</w:t></w:r></w:p>`,
		);
		assert.equal(
			checkStatus(bodyMathDir, 'Math Formatting (Unparsed)'),
			false,
		);

		const cleanDiagramStyle = validateTemplateStyleConformance(
			BASE_STYLES,
			BASE_NUMBERING,
			['STOHeading1'],
		).find(item => item.check === 'Diagram Text Style');
		assert.equal(cleanDiagramStyle?.passed, true);

		const wordNormalizedDiagramStyle = validateTemplateStyleConformance(
			BASE_STYLES.replace(
				'<w:style w:type="paragraph" w:styleId="DiagramText"><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>',
				'<w:style w:type="paragraph" w:styleId="DiagramText"><w:pPr><w:spacing w:line="240"/><w:jc w:val="left"/></w:pPr></w:style>',
			),
			BASE_NUMBERING,
			['STOHeading1'],
		).find(item => item.check === 'Diagram Text Style');
		assert.equal(wordNormalizedDiagramStyle?.passed, true);

		const brokenDiagramStyle = validateTemplateStyleConformance(
			BASE_STYLES.replace(
				'<w:style w:type="paragraph" w:styleId="DiagramText"><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>',
				'<w:style w:type="paragraph" w:styleId="DiagramText"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240"/><w:jc w:val="left"/></w:pPr></w:style>',
			),
			BASE_NUMBERING,
			['STOHeading1'],
		).find(item => item.check === 'Diagram Text Style');
		assert.equal(brokenDiagramStyle?.passed, false);

		console.log(
			'Drawing shapes and AlternateContent validator tests passed.',
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

run();
