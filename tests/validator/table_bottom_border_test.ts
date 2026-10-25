import assert from 'node:assert/strict';

import { getContinuationFailures } from '@/shared/lib/sto-validator/body-xml';
import { hasVisibleOrUnverifiedTableBottom } from '@/shared/lib/sto-validator/table-bottom-border';

import {
	cell,
	documentXml,
	paragraph,
	row,
	style,
	table,
} from './table_layout_fixtures';

export function runTableBottomBorderTests(): void {
	const border = (value: string) => `<w:bottom w:val="${value}"/>`;
	const tableBorder = (value: string) =>
		`<w:tblBorders>${border(value)}</w:tblBorders>`;
	const cellBorder = (value: string) =>
		`<w:tcBorders>${border(value)}</w:tcBorders>`;
	const inherited =
		style('Base', `<w:tblPr>${tableBorder('single')}</w:tblPr>`, 'table') +
		style('Child', '<w:basedOn w:val="Base"/>', 'table');
	const styled = '<w:tblStyle w:val="Child"/>';
	const captionStyle = style('TableCaption', '');
	const caption = (text: string) =>
		paragraph(text, '<w:pStyle w:val="TableCaption"/>');
	const cases: Array<[string, string, string, boolean]> = [
		['absent borders do not invent a bottom', table(), '', false],
		[
			'inherited hyperlink namespace survives extraction',
			table(
				row(
					cell(
						'<w:p><w:hyperlink r:id="rId1"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>',
					) + cell(),
				),
			),
			'',
			false,
		],
		[
			'direct table bottom',
			table(undefined, tableBorder('single')),
			'',
			true,
		],
		['nil table bottom', table(undefined, tableBorder('nil')), '', false],
		['inherited table bottom', table(undefined, styled), inherited, true],
		[
			'direct none overrides inherited table bottom',
			table(undefined, styled + tableBorder('none')),
			inherited,
			false,
		],
		[
			'last cell bottom visible',
			table(
				row() +
					row(cell(paragraph(), cellBorder('single')) + cell(), ''),
			),
			'',
			true,
		],
		[
			'interior row bottom is not final bottom',
			table(
				row(cell(paragraph(), cellBorder('single')) + cell()) +
					row(undefined, ''),
			),
			'',
			false,
		],
		[
			'nil cells do not hide table bottom',
			table(
				row(
					cell(paragraph(), cellBorder('nil')) +
						cell(paragraph(), cellBorder('none')),
				),
				tableBorder('single'),
			),
			'',
			true,
		],
		[
			'inherited cell bottom',
			table(undefined, styled),
			style('Child', `<w:tcPr>${cellBorder('single')}</w:tcPr>`, 'table'),
			true,
		],
		[
			'explicit cells override inherited cell bottom',
			table(
				row(
					cell(paragraph(), cellBorder('nil')) +
						cell(paragraph(), cellBorder('none')),
				),
				styled,
			),
			style('Child', `<w:tcPr>${cellBorder('single')}</w:tcPr>`, 'table'),
			false,
		],
		[
			'unknown conditional border cannot pass',
			table(undefined, styled),
			style(
				'Child',
				`<w:tblStylePr w:type="lastRow"><w:tcPr>${cellBorder('single')}</w:tcPr></w:tblStylePr>`,
				'table',
			),
			true,
		],
		[
			'direct cells resolve conditional cell border',
			table(
				row(
					cell(paragraph(), cellBorder('nil')) +
						cell(paragraph(), cellBorder('none')),
				),
				styled,
			),
			style(
				'Child',
				`<w:tblStylePr w:type="lastRow"><w:tcPr>${cellBorder('single')}</w:tcPr></w:tblStylePr>`,
				'table',
			),
			false,
		],
		[
			'missing style cannot prove absence',
			table(undefined, styled),
			'',
			true,
		],
		[
			'cycle cannot prove absence',
			table(undefined, styled),
			style('Child', '<w:basedOn w:val="Child"/>', 'table'),
			true,
		],
		[
			'row exception bottom',
			table(
				row().replace(
					'<w:tr>',
					`<w:tr><w:tblPrEx>${tableBorder('single')}</w:tblPrEx>`,
				),
			),
			'',
			true,
		],
		[
			'nested table bottom does not leak into parent',
			table(
				row(
					cell(
						paragraph() + table(undefined, tableBorder('single')),
					) + cell(),
				),
			),
			'',
			false,
		],
	];
	for (const [name, previous, styles, failed] of cases) {
		const failures = getContinuationFailures(
			documentXml(
				caption('Таблица 1 – Данные') +
					previous +
					caption('Продолжение таблицы 1') +
					table(),
			),
			captionStyle + styles,
		);
		if (name === 'nested table bottom does not leak into parent') {
			assert.equal(
				hasVisibleOrUnverifiedTableBottom(previous, styles),
				failed,
				name,
			);
			continue;
		}
		assert.equal(failures.label, 0, `${name}: valid label`);
		assert.equal(failures.border, Number(failed), name);
	}
	console.log(
		`Table continuation bottom border: ${cases.length} cases passed.`,
	);
}
