import assert from 'node:assert/strict';

import {
	getBodyElements,
	getContinuationFailures,
} from '@/shared/lib/sto-validator/body-xml';
import { validateTableCaptionDirectFormatting } from '@/shared/lib/sto-validator/table-caption-layout';

import {
	cell,
	documentXml,
	paragraph,
	row,
	style,
	table,
} from './table_layout_fixtures';

export function runTableBodyElementsTests(): void {
	const nested = table(
		row(cell(paragraph('Parent') + table() + '<w:p/>') + cell()),
	);
	const following = paragraph('Following paragraph');
	const cases: Array<[string, string, string[]]> = [
		[
			'comments cannot create body elements',
			'<!-- <w:p>comment</w:p> -->' + following,
			[following],
		],
		[
			'comments cannot close a nested table',
			table(
				row(cell(paragraph() + '<!-- </w:tbl> -->' + table()) + cell()),
			) + following,
			[
				table(
					row(
						cell(paragraph() + '<!-- </w:tbl> -->' + table()) +
							cell(),
					),
				),
				following,
			],
		],
		[
			'selfclosing paragraph retained',
			'<w:p/>' + following,
			['<w:p/>', following],
		],
		[
			'selfclosing table retained',
			'<w:tbl/>' + following,
			['<w:tbl/>', following],
		],
		[
			'selfclosing paragraph does not swallow a table',
			'<w:p />' + table(),
			['<w:p />', table()],
		],
		[
			'nested table stays in its outer body block',
			nested + following,
			[nested, following],
		],
		[
			'selfclosing nested table does not affect depth',
			table(row(cell('<w:tbl/>' + paragraph()) + cell())) + following,
			[table(row(cell('<w:tbl/>' + paragraph()) + cell())), following],
		],
		[
			'TOC content control paragraphs remain discoverable',
			`<w:sdt><w:sdtPr/><w:sdtContent>${paragraph('Contents')}${following}</w:sdtContent></w:sdt>`,
			[paragraph('Contents'), following],
		],
		[
			'body section properties excluded',
			following + '<w:sectPr><w:pgSz w:w="11906"/></w:sectPr>',
			[following],
		],
	];
	for (const [name, body, expected] of cases)
		assert.deepEqual(getBodyElements(documentXml(body)), expected, name);
	const styles = style('TableCaption', '');
	const caption = (text: string, properties = '') =>
		paragraph(text, '<w:pStyle w:val="TableCaption"/>' + properties);
	assert.deepEqual(
		getContinuationFailures(
			documentXml(
				caption('Таблица 1 – Данные') +
					nested +
					caption('Продолжение таблицы 1') +
					table(),
			),
			styles,
		),
		{ label: 0, border: 0 },
		'nested continuation retains the outer table boundary',
	);
	assert.deepEqual(
		getContinuationFailures(
			documentXml(
				caption('Таблица 1 – Данные') +
					'<w:tbl/>' +
					caption('Продолжение таблицы 1') +
					'<w:tbl/>',
			),
			styles,
		),
		{ label: 0, border: 0 },
		'selfclosing tables do not hide the continuation',
	);
	assert.equal(
		getContinuationFailures(
			documentXml(
				caption('Таблица 1 – Данные') +
					table() +
					'<w:p/>' +
					caption('Продолжение таблицы 1') +
					table(),
			),
			styles,
		).label,
		1,
		'empty paragraph breaks immediate continuation adjacency',
	);
	assert.equal(
		validateTableCaptionDirectFormatting(
			documentXml(
				'<w:p/>' +
					caption('Таблица 1 – Данные', '<w:jc w:val="center"/>') +
					nested,
			),
			styles,
		).passed,
		false,
		'selfclosing paragraph cannot hide invalid caption formatting',
	);
	console.log(
		`Word body table extraction: ${cases.length + 4} cases passed.`,
	);
}
