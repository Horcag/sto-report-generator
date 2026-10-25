import assert from 'node:assert/strict';

import {
	activeHeading1StyleIds,
	validateTemplateStyleConformance,
} from '@/shared/lib/sto-template-style-validator';
import { countUncenteredImageParagraphs } from '@/shared/lib/sto-validator/layout-xml';

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

const withImportedBuiltIn = stylesXml.replace(
	'</w:styles>',
	'<w:style w:styleId="Heading1"><w:pPr><w:jc w:val="center"/></w:pPr></w:style></w:styles>',
);
assert.deepEqual(activeHeading1StyleIds(withImportedBuiltIn, '<w:document/>'), [
	'StoHeading1',
]);
assert.ok(
	activeHeading1StyleIds(
		withImportedBuiltIn,
		'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>',
	).includes('Heading1'),
);
for (const check of ['Figure Caption Style', 'Table Caption Style']) {
	assert.equal(
		hasPassed(
			stylesXml.replace(
				/<w:jc w:val="(center|left)"\/>/g,
				'<w:jc w:val="$1"></w:jc>',
			),
			check,
		),
		true,
		'Expanded XML tags must retain their effective properties',
	);
}

const normalizedHeadings = stylesXml
	.replace(
		'<w:styles>',
		'<w:styles><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:line="360"/></w:pPr></w:pPrDefault></w:docDefaults>',
	)
	.replace(
		'<w:style w:styleId="Normal"><w:pPr><w:spacing w:line="360"/></w:pPr></w:style>',
		'<w:style w:styleId="Normal"><w:pPr/></w:style>',
	)
	.replace(
		'<w:spacing w:before="0" w:after="120" w:line="360"/><w:ind w:firstLine="709"/>',
		'<w:spacing w:after="120"/>',
	);
assert.equal(
	hasPassed(normalizedHeadings, 'Numbered Heading Template Style'),
	true,
	'Word may omit heading spacing supplied by defaults and indent supplied by numbering',
);
assert.equal(
	hasPassed(
		normalizedHeadings.replace(
			'<w:spacing w:after="120"/>',
			'<w:spacing w:before="120" w:after="120"/>',
		),
		'Numbered Heading Template Style',
	),
	false,
	'direct wrong heading spacing overrides defaults',
);
assert.equal(
	hasPassed(
		normalizedHeadings.replace('w:line="360"', 'w:line="240"'),
		'Numbered Heading Template Style',
	),
	false,
	'wrong inherited heading line spacing rejected',
);
assert.equal(
	hasPassed(
		normalizedHeadings,
		'Numbered Heading Template Style',
		numberingXml.replace('w:firstLine="709"', 'w:firstLine="708"'),
	),
	false,
	'wrong effective heading numbering indent rejected',
);

const image = (properties: string) =>
	`<w:p><w:pPr>${properties}</w:pPr><w:r><w:drawing/></w:r></w:p>`;
const figureStyle =
	'<w:style w:styleId="Figure"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>';
const imageCases: Array<[string, string, string, number]> = [
	['direct image center', image('<w:jc w:val="center"/>'), '', 0],
	[
		'Word normalized Figure style',
		image('<w:pStyle w:val="Figure"/>'),
		figureStyle,
		0,
	],
	[
		'remapped Figure style',
		image('<w:pStyle w:val="a42"/>'),
		figureStyle.replace('w:styleId="Figure"', 'w:styleId="a42"'),
		0,
	],
	[
		'inherited Figure center',
		image('<w:pStyle w:val="Figure"/>'),
		'<w:style w:styleId="Figure"><w:basedOn w:val="Base"/></w:style><w:style w:styleId="Base"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>',
		0,
	],
	[
		'direct image left overrides style center',
		image('<w:pStyle w:val="Figure"/><w:jc w:val="left"/>'),
		figureStyle,
		1,
	],
	[
		'wrong Figure alignment',
		image('<w:pStyle w:val="Figure"/>'),
		figureStyle.replace('w:val="center"', 'w:val="right"'),
		1,
	],
	['missing image alignment rejected', image(''), '', 1],
	[
		'empty paragraph cannot hide wrong image alignment',
		'<w:p/>' + image('<w:jc w:val="left"/>'),
		figureStyle,
		1,
	],
	[
		'nonimage paragraphs unaffected',
		'<w:p><w:r><w:t>Text</w:t></w:r></w:p>',
		'',
		0,
	],
];
for (const [name, paragraph, styles, expected] of imageCases)
	assert.equal(
		countUncenteredImageParagraphs(paragraph, styles),
		expected,
		name,
	);
console.log(
	`Word-normalized inheritance: 4 heading and ${imageCases.length} image cases passed.`,
);
