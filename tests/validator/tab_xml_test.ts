import assert from 'node:assert/strict';

import { hasForbiddenTabCharacters } from '@/shared/lib/sto-validator/tab-xml';

export function runTabXmlTests(): void {
	const styles = `<w:styles>
		<w:style w:styleId="TitlePageText"><w:name w:val="Title Page Text"/></w:style>
		<w:style w:styleId="RenamedTitle"><w:name w:val="+Тит_Абзац по центру"/></w:style>
		<w:style w:styleId="Contents"><w:name w:val="TOC 2"/></w:style>
		<w:style w:styleId="TOC1"><w:name w:val="+Оглавление 1"/></w:style>
		<w:style w:styleId="RenamedContents"><w:name w:val="+Оглавление 2"/></w:style>
		<w:style w:styleId="Body"><w:name w:val="Normal"/></w:style>
	</w:styles>`;
	const paragraph = (content: string, style = 'Body') =>
		`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${content}</w:p>`;
	const tabStops = '<w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs>';
	const withTabStops = `<w:p><w:pPr>${tabStops}</w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`;
	const cases: [string, string, boolean][] = [
		['paragraph tab stops', withTabStops, false],
		['empty run', paragraph('<w:r/>'), false],
		[
			'empty run before tab stops',
			paragraph('<w:r/>') + withTabStops,
			false,
		],
		['empty paragraph before tab stops', '<w:p/>' + withTabStops, false],
		[
			'empty paragraph and run before tab stops',
			'<w:p/><w:p><w:r/></w:p>' + withTabStops,
			false,
		],
		['body run tab', paragraph('<w:r><w:tab/></w:r>'), true],
		[
			'literal body tab',
			paragraph('<w:r><w:t>Text\ttext</w:t></w:r>'),
			true,
		],
		[
			'empty run before real tab',
			paragraph('<w:r/><w:r><w:tab/></w:r>'),
			true,
		],
		[
			'empty paragraph before real tab',
			'<w:p/>' + paragraph('<w:r><w:tab/></w:r>'),
			true,
		],
		['title tab', paragraph('<w:r><w:tab/></w:r>', 'TitlePageText'), false],
		['TOC tab', paragraph('<w:r><w:tab/></w:r>', 'Contents'), false],
		[
			'native template TOC tab',
			paragraph('<w:r><w:tab/></w:r>', 'TOC1'),
			false,
		],
		[
			'Word-normalized template TOC tab',
			paragraph('<w:r><w:tab/></w:r>', 'RenamedContents'),
			false,
		],
		[
			'empty paragraph before title tab',
			'<w:p/>' + paragraph('<w:r><w:tab/></w:r>', 'TitlePageText'),
			false,
		],
		[
			'literal TOC tab',
			paragraph('<w:r><w:t>Chapter\t3</w:t></w:r>', 'Contents'),
			false,
		],
		[
			'title allowance does not leak to body',
			paragraph('<w:r/>', 'TitlePageText') +
				paragraph('<w:r><w:tab/></w:r>'),
			true,
		],
	];
	for (const [name, body, forbidden] of cases) {
		assert.equal(
			hasForbiddenTabCharacters(
				`<w:document><w:body>${body}</w:body></w:document>`,
				styles,
			),
			forbidden,
			name,
		);
	}
	assert.equal(
		hasForbiddenTabCharacters(
			paragraph('<w:r><w:tab/></w:r>', 'RenamedTitle'),
			styles.replace(
				/<w:style w:styleId="TitlePageText">[\s\S]*?<\/w:style>/,
				'',
			),
		),
		false,
		'Word-normalized title style',
	);
	console.log(`Tab XML regressions: ${cases.length + 1} cases passed.`);
}

if (require.main === module) runTabXmlTests();
