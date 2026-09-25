type Files = Record<string, string>;

interface TestHarness {
	validFiles: (overrides?: Files) => Files;
	expectPass: (name: string, files: Files) => void;
	expectIssue: (name: string, files: Files, code: string) => void;
}

export function runSemanticSourceTests({
	validFiles,
	expectPass,
	expectIssue,
}: TestHarness): void {
	expectPass(
		'inline-lists-simple-and-complex',
		validFiles({
			'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Простые признаки: \\sto_inline_list{simple}{цвет|форма|размер}.

Сложные признаки: \\sto_inline_list{complex}{цвет, измеренный утром|форма, полученная расчетом}.
`,
		}),
	);
	expectIssue(
		'inline-list-simple-has-comma',
		validFiles({
			'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Признаки: \\sto_inline_list{simple}{цвет, измеренный утром|форма}.
`,
		}),
		'inline-list-simple-complex-item',
	);
	expectIssue(
		'inline-list-invalid-kind',
		validFiles({
			'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Признаки: \\sto_inline_list{mixed}{цвет|форма}.
`,
		}),
		'inline-list-kind-invalid',
	);
	expectPass(
		'referat-semantic-fields-and-terms',
		validFiles({
			'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

{{PAGES}} страниц и {{SOURCES}} источников.

\\sto_referat_characteristics{Разработан и испытан метод классификации.}

\\sto_referat_application{Метод применим к архивам документов.}
`,
			'02b_terms.md': `\\sto_structural_heading{ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ}

\\begin{sto_terms}
АБВ | Автоматический блок выбора
β | коэффициент отклонения | рад
\\end{sto_terms}
`,
		}),
	);
	expectIssue(
		'empty-referat-characteristics',
		validFiles({
			'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

{{PAGES}} страниц и {{SOURCES}} источников.
\\sto_referat_characteristics{}
`,
		}),
		'referat-characteristics-invalid',
	);
	expectIssue(
		'out-of-order-terms',
		validFiles({
			'02b_terms.md': `\\sto_structural_heading{ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ}

\\begin{sto_terms}
Бета | коэффициент
Альфа | величина
\\end{sto_terms}
`,
		}),
		'sto-terms-order',
	);
	expectIssue(
		'malformed-term',
		validFiles({
			'02b_terms.md': `\\sto_structural_heading{ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ}

\\begin{sto_terms}
Альфа |
\\end{sto_terms}
`,
		}),
		'sto-term-row-invalid',
	);
	expectIssue(
		'missing-terms-block',
		validFiles({
			'02b_terms.md':
				'\\sto_structural_heading{ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ}\n',
		}),
		'sto-terms-missing',
	);
}
