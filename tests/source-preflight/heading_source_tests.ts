type Files = Record<string, string>;

interface TestHarness {
	validFiles: (overrides?: Files) => Files;
	expectIssue: (name: string, files: Files, code: string) => void;
	expectWarning: (name: string, files: Files, code: string) => void;
	expectNoIssue: (name: string, files: Files, code: string) => void;
}

export function runHeadingSourceTests({
	validFiles,
	expectIssue,
	expectWarning,
	expectNoIssue,
}: TestHarness): void {
	expectWarning(
		'heading-lowercase-after-number',
		validFiles({
			'03_intro.md': `# 1.2 строчная буква

Текст без нарушений.
`,
		}),
		'markdown-heading-lowercase-start',
	);

	expectNoIssue(
		'heading-uppercase-after-number-and-internal-period',
		validFiles({
			'03_intro.md': `# 1.2 Исходные данные. Методы анализа

Текст без нарушений.
`,
		}),
		'markdown-heading-final-period',
	);

	expectNoIssue(
		'heading-uppercase-after-number',
		validFiles({
			'03_intro.md': `# 1.2 Исходные данные

Текст без нарушений.
`,
		}),
		'markdown-heading-lowercase-start',
	);

	expectNoIssue(
		'heading-inline-html-tag-is-not-first-letter',
		validFiles({
			'03_intro.md': `# <em>Заголовок</em>

Текст без нарушений.
`,
		}),
		'markdown-heading-lowercase-start',
	);

	expectIssue(
		'numbered-heading-explicit-underline',
		validFiles({
			'03_intro.md': `# <u>Подчёркнутый заголовок</u>

Текст без нарушений.
`,
		}),
		'markdown-heading-underline',
	);

	expectIssue(
		'structural-heading-explicit-underline',
		validFiles({
			'03_intro.md': `\\sto_structural_heading{<u>ВВЕДЕНИЕ</u>}

Текст без нарушений.
`,
		}),
		'structural-heading-underline',
	);

	expectNoIssue(
		'code-fence-heading-underline-is-not-heading',
		validFiles({
			'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

\`\`\`md
# <u>Пример синтаксиса</u>
\`\`\`
`,
		}),
		'markdown-heading-underline',
	);

	expectNoIssue(
		'inline-code-underline-is-literal',
		validFiles({
			'03_intro.md': `# Пример тега \`<u>\`

Текст без нарушений.
`,
		}),
		'markdown-heading-underline',
	);
}
