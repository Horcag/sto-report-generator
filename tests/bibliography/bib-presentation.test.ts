import assert from 'node:assert/strict';

import {
	collectAllCitationKeys,
	SourcePreflightIssue,
} from '@/shared/lib/source-preflight';
import { validateCitationContext } from '@/shared/lib/source-preflight/bibliography-citations';
import { validateBibliographyPresentation } from '@/shared/lib/sto-validator/bibliography-xml';

const paragraph = (content: string) => `<w:p>${content}</w:p>`;
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const heading = paragraph(text('Список использованных источников'));
const doc = (body: string) =>
	`<w:document><w:body>${body}</w:body></w:document>`;
const check = (body: string) =>
	validateBibliographyPresentation(doc(body)).find(
		item => item.check === 'Bibliography Plain URL Text',
	)!.passed;
const link =
	'<w:hyperlink r:id="rId9"><w:r><w:rPr><w:color w:val="000000"/><w:u w:val="none"/></w:rPr><w:t>https://example.org</w:t></w:r></w:hyperlink>';

assert.equal(
	check(heading + paragraph(text('URL: https://example.org.'))),
	true,
);
assert.equal(
	check(
		paragraph(link) +
			heading +
			paragraph(text('URL: https://example.org.')),
	),
	true,
	'Links elsewhere do not make plain bibliography URLs invalid',
);
assert.equal(
	check(heading + paragraph(link)),
	false,
	'Restyling an active hyperlink does not remove it',
);
assert.equal(
	check(
		heading +
			paragraph(
				'<w:fldSimple w:instr=" HYPERLINK &quot;https://example.org&quot; "><w:r><w:t>URL</w:t></w:r></w:fldSimple>',
			),
	),
	false,
);
assert.equal(
	check(
		heading +
			paragraph(
				'<w:r><w:instrText> HYPER</w:instrText></w:r><w:r><w:instrText>LINK &quot;https://example.org&quot; </w:instrText></w:r>',
			),
	),
	false,
);
assert.equal(
	check(
		heading +
			paragraph(
				'<w:hyperlink w:anchor="citation"><w:r><w:t>Internal link</w:t></w:r></w:hyperlink>',
			),
	),
	true,
);
assert.equal(
	check(
		heading +
			paragraph(text('Source.')) +
			paragraph(
				'<w:pPr><w:pStyle w:val="AppendixHeading"/></w:pPr>' +
					text('Приложение А'),
			) +
			paragraph(link),
	),
	true,
	'Appendix links are outside the bibliography',
);
assert.equal(
	validateBibliographyPresentation(
		doc(heading + paragraph(text('[Электронный ресурс]'))),
	)[0].passed,
	false,
);
const citationIssues = (content: string) => {
	const issues: SourcePreflightIssue[] = [];
	validateCitationContext([{ file: 'text.md', content }], issues);
	return issues.map(issue => issue.code);
};
assert.ok(
	citationIssues('Подтверждённый факт. [@source]').includes(
		'bibliography-citation-after-punctuation',
	),
);
assert.deepEqual(citationIssues('Подтверждённый факт [@source].'), []);
assert.deepEqual(
	citationIssues('См. [@source]. Диапазон $[1, 3]$, `a[1]` и [0, 1].'),
	[],
);
assert.deepEqual(
	citationIssues(
		'Интервалы [0,00708982; 0,00945664], [13,5; 91,9] и [−0,001; 0,002].',
	),
	[],
);
assert.ok(
	citationIssues('Подтверждённый факт [3, с. 12].').includes(
		'bibliography-manual-citation-number',
	),
);
const examples =
	'```md\n[@literal]\n[1]\n```\nПример `[@inline]`, формула $[@symbol]$; настоящий источник [@real, с. 12].';
assert.deepEqual(
	collectAllCitationKeys([{ file: 'text.md', content: examples }]),
	['real'],
);
assert.deepEqual(citationIssues(examples), []);
assert.deepEqual(
	collectAllCitationKeys([
		{
			file: 'table.md',
			content:
				'| Source | Value |\n|---|---|\n| [@tableOnly] | `[@literal]` |\n\nProse [@prose].',
		},
	]),
	['tableOnly', 'prose'],
);
console.log(
	'PASS bibliography presentation: 8 scenarios including black unstyled hyperlinks, field codes, split instructions, and section boundaries.',
);
console.log(
	'PASS bibliography citation context: 7 scenarios including sentence punctuation, manual numbering, code and formula exclusions.',
);
