import assert from 'node:assert/strict';

import { countTableHeaderFinalPeriods } from '@/shared/lib/sto-validator/layout-xml';
import {
	countTablesWithoutHeaderRepeat,
	validateTableLayout,
} from '@/shared/lib/sto-validator/table-layout';

import {
	cell,
	documentXml,
	paragraph,
	row,
	style,
	table,
} from './table_layout_fixtures';
import { runTableStyleCascadeCases } from './table_style_cases';

const CHECKS = [
	'Table Header Horizontal Alignment',
	'Table Grid Structure',
	'Table Header Repeat Order',
];

export function runTableLayoutTests(): void {
	let cases = 0;
	const check = (
		name: string,
		body: string,
		failed: string[] = [],
		styles = '',
	) => {
		const results = validateTableLayout(documentXml(body), styles);
		assert.deepEqual(
			results.map(result => result.check),
			CHECKS,
			`${name}: all checks discovered`,
		);
		assert.deepEqual(
			results
				.filter(result => !result.passed)
				.map(result => result.check),
			failed,
			name,
		);
		for (const result of results.filter(result => !result.passed))
			assert.match(
				result.error ?? '',
				/word\/document\.xml: table \d+, row \d+/,
				name,
			);
		cases++;
	};
	check('no data tables required', paragraph('Text'));
	check('centered headings and numeric body aligned right', table());
	check(
		'first row is a heading without repeat flag',
		table(row(undefined, '')),
	);
	check(
		'missing repeat does not hide left aligned heading',
		table(
			row(cell(paragraph('Name', '<w:jc w:val="left"/>')) + cell(), ''),
		),
		[CHECKS[0]],
	);
	check(
		'header alignment absent defaults left',
		table(row(cell(paragraph('Name', '')) + cell())),
		[CHECKS[0]],
	);
	check(
		'top vertical alignment allowed',
		table(row(cell(paragraph(), '<w:vAlign w:val="top"/>') + cell())),
	);
	check(
		'bottom vertical alignment allowed',
		table(row(cell(paragraph(), '<w:vAlign w:val="bottom"/>') + cell())),
	);
	check(
		'body text alignment unrestricted',
		table(
			row() +
				row(
					cell(paragraph('Text', '<w:jc w:val="both"/>')) + cell(),
					'',
				),
		),
	);
	check(
		'all contiguous heading rows checked',
		table(
			row() +
				row(
					cell(paragraph('Subheading', '<w:jc w:val="left"/>')) +
						cell(),
				),
		),
		[CHECKS[0]],
	);
	check('multiple valid heading rows', table(row() + row()));
	for (const value of ['0', 'false', 'off']) {
		check(
			`false repeat ${value} ends header`,
			table(
				row() +
					row(
						cell(paragraph('Data', '<w:jc w:val="right"/>')) +
							cell(),
						`<w:tblHeader w:val="${value}"/>`,
					),
			),
		);
		assert.equal(
			countTablesWithoutHeaderRepeat(
				documentXml(
					table(
						row(undefined, `<w:tblHeader w:val="${value}"/>`) +
							row(undefined, ''),
					),
				),
			),
			1,
			`false ${value} not counted as repeat`,
		);
	}
	check(
		'repeat after body invalid',
		table(row() + row(undefined, '') + row()),
		[CHECKS[2]],
	);
	check(
		'repeat after unmarked first row invalid',
		table(row(undefined, '') + row()),
		[CHECKS[2]],
	);
	const inherited =
		style('Parent', '<w:pPr><w:jc w:val="center"/></w:pPr>') +
		style('Child', '<w:basedOn w:val="Parent"/>');
	check(
		'paragraph style inheritance',
		table(
			row(cell(paragraph('Name', '<w:pStyle w:val="Child"/>')) + cell()),
		),
		[],
		inherited,
	);
	check(
		'direct alignment overrides paragraph inheritance',
		table(
			row(
				cell(
					paragraph(
						'Name',
						'<w:pStyle w:val="Child"/><w:jc w:val="right"/>',
					),
				) + cell(),
			),
		),
		[CHECKS[0]],
		inherited,
	);
	check(
		'cyclic style chain terminates',
		table(
			row(cell(paragraph('Name', '<w:pStyle w:val="Loop"/>')) + cell()),
		),
		[CHECKS[0]],
		style('Loop', '<w:basedOn w:val="Loop"/>'),
	);
	check(
		'document defaults center',
		table(row(cell(paragraph('Name', '')) + cell())),
		[],
		'<w:styles><w:docDefaults><w:pPrDefault><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
	);
	check(
		'default paragraph style center',
		table(row(cell(paragraph('Name', '')) + cell())),
		[],
		style(
			'Normal',
			'<w:pPr><w:jc w:val="center"/></w:pPr>',
			'paragraph',
			'w:default="1"',
		),
	);
	const noDirect = row(
		cell(paragraph('Name', '')) + cell(paragraph('Value', '')),
	);
	const conditionalStyle = style(
		'Table',
		'<w:tblStylePr w:type="firstRow"><w:pPr><w:jc w:val="center"/></w:pPr></w:tblStylePr>',
		'table',
	);
	const look = '<w:tblStyle w:val="Table"/><w:tblLook w:firstRow="1"/>';
	check(
		'table conditional first row alignment',
		table(noDirect, look),
		[],
		conditionalStyle,
	);
	check(
		'table look bitmask',
		table(noDirect, '<w:tblStyle w:val="Table"/><w:tblLook w:val="0020"/>'),
		[],
		conditionalStyle,
	);
	check(
		'table condition explicitly disabled',
		table(
			noDirect,
			'<w:tblStyle w:val="Table"/><w:tblLook w:val="0020" w:firstRow="0"/>',
		),
		[CHECKS[0]],
		conditionalStyle,
	);
	check(
		'explicit row condition',
		table(
			row(
				cell(paragraph('Name', '')) + cell(paragraph('Value', '')),
				'<w:tblHeader/><w:cnfStyle w:firstRow="1"/>',
			),
			'<w:tblStyle w:val="Table"/>',
		),
		[],
		conditionalStyle,
	);
	check(
		'direct override table condition',
		table(
			row(cell(paragraph('Name', '<w:jc w:val="left"/>')) + cell()),
			look,
		),
		[CHECKS[0]],
		conditionalStyle,
	);
	check(
		'table base style inherited',
		table(noDirect, '<w:tblStyle w:val="Derived"/>'),
		[],
		style('Base', '<w:pPr><w:jc w:val="center"/></w:pPr>', 'table') +
			style('Derived', '<w:basedOn w:val="Base"/>', 'table'),
	);
	check(
		'merged heading spans grid',
		table(row(cell(paragraph(), '<w:gridSpan w:val="2"/>'))),
	);
	check('row missing grid column', table(row(cell())), [CHECKS[1]]);
	check('row exceeds grid', table(row(cell() + cell() + cell())), [
		CHECKS[1],
	]);
	check(
		'invalid zero span',
		table(row(cell(paragraph(), '<w:gridSpan w:val="0"/>') + cell())),
		[CHECKS[1]],
	);
	check(
		'gridBefore and gridAfter are legitimate',
		table(
			row(cell(), '<w:gridBefore w:val="1"/>') +
				row(cell(), '<w:gridAfter w:val="1"/>'),
		),
	);
	check(
		'vertical merged continuation is legitimate',
		table(
			row(cell(paragraph(), '<w:vMerge w:val="restart"/>') + cell()) +
				row(cell('<w:p/>', '<w:vMerge/>') + cell(), ''),
		),
	);
	check(
		'preferred width need not equal grid',
		table(
			row(cell(paragraph(), '<w:tcW w:type="dxa" w:w="1900"/>') + cell()),
		),
	);
	check('no grid does not invent widths', table(row(), '', ''));
	check(
		'all header paragraphs checked',
		table(
			row(
				cell(
					paragraph() + paragraph('Second', '<w:jc w:val="left"/>'),
				) + cell(),
			),
		),
		[CHECKS[0]],
	);
	check(
		'namespace inherited from document',
		table(
			row(
				cell(
					'<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>',
				) + cell(),
			),
		),
	);
	check(
		'styles declaration accepted',
		table(noDirect, look),
		[],
		`<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${conditionalStyle}</w:styles>`,
	);
	check(
		'title tables excluded before referat',
		table(row(cell(paragraph('Title', '<w:jc w:val="left"/>')))) +
			paragraph('РЕФЕРАТ') +
			table(),
	);
	const formula = table(
		row(
			cell('<w:p/>') +
				cell(
					'<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>',
				) +
				cell(paragraph('(1)', '<w:jc w:val="right"/>')),
			'',
		),
		'',
		'',
	);
	check('formula wrapper excluded', formula);
	assert.equal(countTablesWithoutHeaderRepeat(documentXml(formula)), 0);
	assert.equal(countTablesWithoutHeaderRepeat(documentXml(table())), 0);
	assert.equal(
		countTableHeaderFinalPeriods(
			documentXml(
				table(
					row() +
						row(cell(paragraph('Subheading.')) + cell()) +
						row(cell(paragraph('Data.')) + cell(), ''),
				),
			),
		),
		1,
		'period checked in second heading but not body',
	);
	assert.equal(
		countTableHeaderFinalPeriods(
			documentXml(
				table(
					row(undefined, '') +
						row(
							cell(paragraph('Body.')) + cell(),
							'<w:tblHeader w:val="false"/>',
						) +
						row(cell(paragraph('Later.')) + cell()),
				),
			),
		),
		0,
		'false flag ends contiguous headings for punctuation',
	);
	assert.equal(
		countTableHeaderFinalPeriods(
			documentXml(table(row(cell(paragraph('First.')) + cell(), ''))),
		),
		1,
		'first heading punctuation checked without repeat',
	);
	check(
		'nested heading checked separately',
		table(
			row(
				cell(
					table(
						row(
							cell(paragraph('Nested', '<w:jc w:val="left"/>')) +
								cell(),
						),
					),
				) + cell(),
			),
		),
		[CHECKS[0]],
	);
	check(
		'wholeTable conditional base',
		table(noDirect, '<w:tblStyle w:val="Whole"/>'),
		[],
		style(
			'Whole',
			'<w:tblStylePr w:type="wholeTable"><w:pPr><w:jc w:val="center"/></w:pPr></w:tblStylePr>',
			'table',
		),
	);
	check(
		'malformed span without grid still fails',
		table(
			row(cell(paragraph(), '<w:gridSpan w:val="0"/>') + cell()),
			'',
			'',
		),
		[CHECKS[1]],
	);
	check(
		'conditional formatting bit string',
		table(
			row(
				cell(paragraph('Name', '')) + cell(paragraph('Value', '')),
				'<w:tblHeader/><w:cnfStyle w:val="100000000000"/>',
			),
			'<w:tblStyle w:val="Table"/>',
		),
		[],
		conditionalStyle,
	);
	check(
		'parent heading checked despite valid nested table',
		table(
			row(
				cell(paragraph('Parent', '<w:jc w:val="left"/>') + table()) +
					cell(),
			),
		),
		[CHECKS[0]],
	);
	check(
		'parent grid checked despite valid nested table',
		table(row(cell(paragraph() + table()))),
		[CHECKS[1]],
	);
	check(
		'nested valid table accepted',
		table(row(cell(paragraph() + table()) + cell())),
	);
	check(
		'omitted table style does not apply default base',
		table(noDirect),
		[CHECKS[0]],
		style(
			'DefaultTable',
			'<w:pPr><w:jc w:val="center"/></w:pPr>',
			'table',
			'w:default="1"',
		),
	);
	check(
		'omitted table style does not apply default conditional',
		table(noDirect, '<w:tblLook w:firstRow="1"/>'),
		[CHECKS[0]],
		style(
			'DefaultTable',
			'<w:tblStylePr w:type="firstRow"><w:pPr><w:jc w:val="center"/></w:pPr></w:tblStylePr>',
			'table',
			'w:default="1"',
		),
	);
	check(
		'title nested tables excluded',
		table(
			row(
				cell(
					table(
						row(
							cell(
								paragraph(
									'Nested title',
									'<w:jc w:val="left"/>',
								),
							) + cell(),
						),
					),
				) + cell(),
			),
		) +
			paragraph('РЕФЕРАТ') +
			table(),
	);
	runTableStyleCascadeCases(check);
	assert.equal(cases, 54, 'all table layout cases executed');
	console.log(
		`Table layout regressions: ${cases} cases passed; all 3 checks executed per case. Fixtures remained in memory.`,
	);
}

if (require.main === module) runTableLayoutTests();
