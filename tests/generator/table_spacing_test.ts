import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { normalizeDataTableSpacing } from '@/shared/lib/docx/table-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const styles = `<w:styles xmlns:w="${W}"><w:style w:styleId="WideGap"><w:basedOn w:val="Parent"/></w:style><w:style w:styleId="Parent"><w:pPr><w:spacing w:before="360"/></w:pPr></w:style><w:style w:styleId="TableFollowingText"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120"/></w:pPr></w:style></w:styles>`;
const caption = '<w:p><w:r><w:t>Таблица 1</w:t></w:r></w:p>';
const table =
	'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const cases = JSON.parse(
	readFileSync('tests/fixtures/generator/table-spacing-cases.json', 'utf8'),
) as Array<{
	name: string;
	paragraph: string;
	before: string | null;
	unchanged?: boolean;
}>;

for (const test of cases) {
	const xml = `<w:document xmlns:w="${W}"><w:body>${caption}${table}${test.paragraph}</w:body></w:document>`;
	const result = normalizeDataTableSpacing(xml, styles);
	if (test.unchanged) assert.equal(result, xml, test.name);
	assert.equal(
		normalizeDataTableSpacing(result, styles),
		result,
		`${test.name}: idempotent`,
	);
	const dom = new JSDOM(result, { contentType: 'text/xml' });
	try {
		const body = dom.window.document.getElementsByTagNameNS(W, 'body')[0];
		const next = body.children[2];
		assert.equal(
			next
				?.getElementsByTagNameNS(W, 'spacing')[0]
				?.getAttributeNS(W, 'before') ?? null,
			test.before,
			test.name,
		);
		assert.equal(
			body.children.length,
			test.paragraph ? 3 : 2,
			`${test.name}: no inserted blank paragraph`,
		);
		if (test.name === 'normal-text')
			assert.equal(
				next
					.getElementsByTagNameNS(W, 'pStyle')[0]
					?.getAttributeNS(W, 'val'),
				'TableFollowingText',
			);
		if (test.name === 'small-spacing-raised') {
			const spacing = next.getElementsByTagNameNS(W, 'spacing')[0];
			assert.equal(spacing.getAttributeNS(W, 'after'), '240');
			assert.equal(spacing.getAttributeNS(W, 'line'), '360');
		}
	} finally {
		dom.window.close();
	}
}
// Title-page tables and formula wrappers must not receive data-table formatting.
for (const xml of [
	`<w:document xmlns:w="${W}"><w:body>${table}<w:p><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>РЕФЕРАТ</w:t></w:r></w:p></w:body></w:document>`,
	`<w:document xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${caption}<w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:tc><w:tc><w:p><w:r><w:t>(1)</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`,
])
	assert.equal(normalizeDataTableSpacing(xml, styles), xml);
console.log(
	`Table spacing: ${cases.length} shared TypeScript/Python cases plus frontmatter/formula exclusions passed.`,
);
