import assert from 'node:assert/strict';

import { validateTableLayout } from '@/shared/lib/sto-validator/table-layout';

import {
	cell,
	documentXml,
	paragraph,
	row,
	style,
	table,
} from './table_layout_fixtures';

export function runTableStyleCascadeCases(
	check: (
		name: string,
		body: string,
		failed?: string[],
		styles?: string,
	) => void,
): void {
	const CHECKS = ['Table Header Horizontal Alignment'];
	const noDirect = row(
		cell(paragraph('Name', '')) + cell(paragraph('Value', '')),
	);
	const look = '<w:tblStyle w:val="Table"/><w:tblLook w:firstRow="1"/>';
	const conditionalStyle = style(
		'Table',
		'<w:tblStylePr w:type="firstRow"><w:pPr><w:jc w:val="center"/></w:pPr></w:tblStylePr>',
		'table',
	);
	check(
		'firstRow style applies to repeated heading rows',
		table(noDirect + noDirect, look),
		[],
		conditionalStyle,
	);
	const cornerStyle = style(
		'Table',
		'<w:pPr><w:jc w:val="center"/></w:pPr><w:tblStylePr w:type="nwCell"><w:pPr><w:jc w:val="left"/></w:pPr></w:tblStylePr>',
		'table',
	);
	check(
		'corner conditional override checked',
		table(
			noDirect,
			'<w:tblStyle w:val="Table"/><w:tblLook w:firstRow="1" w:firstColumn="1"/>',
		),
		[CHECKS[0]],
		cornerStyle,
	);
	check(
		'inactive corner does not override',
		table(noDirect, '<w:tblStyle w:val="Table"/>'),
		[],
		cornerStyle,
	);
	const bandStyle = style(
		'Table',
		'<w:pPr><w:jc w:val="center"/></w:pPr><w:tblStylePr w:type="band1Horz"><w:pPr><w:jc w:val="left"/></w:pPr></w:tblStylePr>',
		'table',
	);
	check(
		'unresolved band alignment fails explicitly',
		table(noDirect, '<w:tblStyle w:val="Table"/>'),
		[CHECKS[0]],
		bandStyle,
	);
	assert.match(
		validateTableLayout(
			documentXml(table(noDirect, '<w:tblStyle w:val="Table"/>')),
			bandStyle,
		)[0].error ?? '',
		/unverified conditional band alignment/,
	);
	check(
		'disabled band does not override',
		table(
			noDirect,
			'<w:tblStyle w:val="Table"/><w:tblLook w:noHBand="1"/>',
		),
		[],
		bandStyle,
	);
}
