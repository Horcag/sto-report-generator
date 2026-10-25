import assert from 'node:assert/strict';

import { validateTableCaptionDirectFormatting } from '@/shared/lib/sto-validator/table-caption-layout';

import { documentXml, paragraph, style, table } from './table_layout_fixtures';

export function runTableCaptionLayoutTests(): void {
	const styles = style(
		'TableCaption',
		'<w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/><w:spacing w:line="240"/></w:pPr>',
	);
	const cases: Array<[string, string, boolean]> = [
		['style formatting retained', '', true],
		[
			'matching explicit format',
			'<w:jc w:val="left"/><w:ind w:firstLine="0" w:left="0"/><w:spacing w:line="240" w:lineRule="auto"/>',
			true,
		],
		['center override rejected', '<w:jc w:val="center"/>', false],
		['first line override rejected', '<w:ind w:firstLine="709"/>', false],
		['hanging override rejected', '<w:ind w:hanging="709"/>', false],
		['left offset rejected', '<w:ind w:left="709"/>', false],
		['character indent rejected', '<w:ind w:firstLineChars="100"/>', false],
		['1.5 spacing rejected', '<w:spacing w:line="360"/>', false],
		[
			'exact 12pt is not single spacing',
			'<w:spacing w:line="240" w:lineRule="exact"/>',
			false,
		],
		[
			'line rule override without value rejected',
			'<w:spacing w:lineRule="atLeast"/>',
			false,
		],
	];
	for (const [name, properties, passed] of cases) {
		const result = validateTableCaptionDirectFormatting(
			documentXml(
				paragraph(
					'Таблица 1 – Данные',
					`<w:pStyle w:val="TableCaption"/>${properties}`,
				) + table(),
			),
			styles,
		);
		assert.equal(result.passed, passed, name);
		if (!passed)
			assert.match(
				result.error ?? '',
				/word\/document\.xml: paragraph 1/,
			);
	}
	assert.equal(
		validateTableCaptionDirectFormatting(
			documentXml(paragraph('Text', '<w:jc w:val="center"/>')),
			styles,
		).passed,
		true,
		'ordinary paragraphs excluded',
	);
	assert.equal(
		validateTableCaptionDirectFormatting(
			documentXml(
				paragraph(
					'Таблица 1 – Титул',
					'<w:pStyle w:val="TableCaption"/><w:jc w:val="center"/>',
				) + paragraph('РЕФЕРАТ'),
			),
			styles,
		).passed,
		true,
		'frontmatter excluded',
	);
	console.log(
		`Table caption direct formatting: ${cases.length + 2} cases passed.`,
	);
}
