import assert from 'node:assert/strict';

import { validateTemplateStyleConformance } from '@/shared/lib/sto-template-style-validator';

const stylesXml = `<w:styles>
	<w:style w:styleId="Normal"><w:pPr><w:spacing w:line="360"/></w:pPr></w:style>
	<w:style w:styleId="STOHeading1"><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="0" w:after="120" w:line="360"/><w:ind w:firstLine="709"/></w:pPr></w:style>
	<w:style w:styleId="StructuralHeading"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120" w:line="360"/><w:jc w:val="center"/><w:pageBreakBefore/></w:pPr></w:style>
	<w:style w:styleId="TitlePageText"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>
	<w:style w:styleId="StructuralHeadingNoTOC"><w:basedOn w:val="TitlePageText"/><w:pPr><w:spacing w:before="0" w:after="240" w:line="240"/><w:jc w:val="center"/><w:pageBreakBefore/></w:pPr></w:style>
	<w:style w:styleId="FigureCaption"><w:pPr><w:spacing w:before="120" w:after="240" w:line="240"/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:keepLines/></w:pPr></w:style>
	<w:style w:styleId="TableCaption"><w:pPr><w:spacing w:before="120" w:after="120" w:line="240"/><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:keepNext/><w:keepLines/></w:pPr></w:style>
	<w:style w:styleId="TableText"><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/></w:pPr></w:style>
</w:styles>`;

const numberingXml = `<w:numbering>
	<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:pPr><w:ind w:left="0" w:firstLine="709"/></w:pPr></w:lvl></w:abstractNum>
	<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function hasPassed(
	xml: string,
	check: string,
	numbering = numberingXml,
): boolean {
	const result = validateTemplateStyleConformance(xml, numbering, [
		'StoHeading1',
	]).find(item => item.check === check);
	assert.ok(result, `Validation check not found: ${check}`);
	return result.passed;
}

for (const check of [
	'Numbered Heading Template Style',
	'Numbered Heading Effective Indent',
	'Structural Heading Spacing',
	'Title Page Base Style',
	'Figure Caption Style',
	'Table Caption Style',
	'Table Text Style',
]) {
	assert.equal(hasPassed(stylesXml, check), true, check);
}

assert.equal(
	hasPassed(
		stylesXml,
		'Numbered Heading Effective Indent',
		numberingXml.replace('w:firstLine="709"', 'w:firstLine="708"'),
	),
	false,
);

assert.equal(
	hasPassed(
		stylesXml.replace(
			'<w:style w:styleId="StructuralHeading"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120"',
			'<w:style w:styleId="StructuralHeading"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="240"',
		),
		'Structural Heading Spacing',
	),
	false,
);
assert.equal(
	hasPassed(
		stylesXml.replace(
			'<w:keepLines/></w:pPr></w:style>\n\t<w:style w:styleId="TableCaption"',
			'</w:pPr></w:style>\n\t<w:style w:styleId="TableCaption"',
		),
		'Figure Caption Style',
	),
	false,
);

console.log('Template style conformance tests passed.');
