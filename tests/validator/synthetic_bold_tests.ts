import assert from 'node:assert/strict';

import type { GetCheck, WriteXmlFixture } from './synthetic_validator_tests';

export function runSyntheticBoldTests(
	writeXmlFixture: WriteXmlFixture,
	getCheck: GetCheck,
	namespaces: string,
	bodyStyles: string,
): void {
	const boldCase = (
		name: string,
		paragraph: string,
		styles: string,
		expected: boolean,
	) => {
		const fixture = writeXmlFixture(
			name,
			`<w:document ${namespaces}><w:body><w:p><w:pPr><w:pStyle w:val="StructuralHeading"/></w:pPr><w:r><w:t>РЕФЕРАТ</w:t></w:r></w:p>${paragraph}</w:body></w:document>`,
			styles,
		);
		assert.equal(
			getCheck(fixture, 'Ordinary Body Bold Text').passed,
			expected,
			name,
		);
	};
	const referatField =
		'<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Основные характеристики: </w:t></w:r><w:r><w:t>Текст.</w:t></w:r></w:p>';
	boldCase(
		'referat-plain-label-bold-heading-exception',
		referatField,
		bodyStyles.replace(
			'</w:styles>',
			'<w:style w:type="paragraph" w:styleId="StructuralHeading"><w:rPr><w:b/></w:rPr></w:style></w:styles>',
		),
		true,
	);
	boldCase(
		'referat-default-bold',
		referatField,
		bodyStyles.replace(
			'<w:docDefaults>',
			'<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault>',
		),
		false,
	);
	boldCase(
		'referat-direct-bold',
		referatField.replace(
			'<w:r><w:t>Основные',
			'<w:r><w:rPr><w:b/></w:rPr><w:t>Основные',
		),
		bodyStyles,
		false,
	);
	boldCase(
		'referat-inherited-bold',
		referatField,
		bodyStyles.replace(
			'<w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style>',
			'<w:pPr><w:ind w:firstLine="709"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>',
		),
		false,
	);
	boldCase(
		'referat-character-style-bold',
		referatField.replace(
			'<w:r><w:t>Основные',
			'<w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>Основные',
		),
		bodyStyles.replace(
			'</w:styles>',
			'<w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:b/></w:rPr></w:style></w:styles>',
		),
		false,
	);
	boldCase(
		'referat-direct-bold-off',
		referatField.replaceAll(
			'<w:r><w:t>',
			'<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>',
		),
		bodyStyles.replace(
			'<w:pPr><w:ind w:firstLine="709"/></w:pPr></w:style>',
			'<w:pPr><w:ind w:firstLine="709"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>',
		),
		true,
	);
}
