import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveReportConfig } from '@/shared/lib/report-config';
import { runSourcePreflight } from '@/shared/lib/source-preflight';

import { runBibliographyRegressionTests } from './bibliography_regression_tests';
import { runStructureReferenceTests } from './structure_reference_tests';

const tempRoot = path.join(
	process.cwd(),
	'.agent-work',
	'source-preflight-tests',
);

function writeReport(name: string, files: Record<string, string>): string {
	const dir = path.join(tempRoot, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [file, content] of Object.entries(files)) {
		const filePath = path.join(dir, file);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, 'utf8');
	}
	return dir;
}

function validFiles(
	overrides: Record<string, string> = {},
): Record<string, string> {
	const defaults = {
		'00_metadata.md': `---
title: Test
---
`,
		'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

Отчет содержит {{PAGES}} страниц, {{FIGURES}} рисунков, {{TABLES}} таблиц и {{SOURCES}} источников.
`,
		'02_toc.md': `\\sto_structural_heading{СОДЕРЖАНИЕ}
`,
		'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Текст введения без нарушений.
`,
		'90_conclusion.md': `\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

Выводы представлены корректно.
`,
		'91_sources.md': `\\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}

\\begin{sto_bibliography}
\\end{sto_bibliography}
`,
	};
	const normalizedOverrides = Object.fromEntries(
		Object.entries(overrides).map(([file, content]) => [
			file,
			file === '03_intro.md' &&
			!content.includes('\\sto_structural_heading')
				? `\\sto_structural_heading{ВВЕДЕНИЕ}\n\n${content}`
				: content,
		]),
	);
	return { ...defaults, ...normalizedOverrides };
}

function labFiles(
	overrides: Record<string, string> = {},
): Record<string, string> {
	return {
		'report.config.json': JSON.stringify(
			{
				profile: 'lab',
				sourceDir: '.',
				outputDocx: 'build/lab.docx',
				document: {
					requiredStructuralHeadings: ['ВВЕДЕНИЕ', 'ЗАКЛЮЧЕНИЕ'],
					optionalStructuralHeadings: [
						'СОДЕРЖАНИЕ',
						'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ',
					],
					requireReferat: false,
					requireSources: 'when-cited',
				},
				preflight: {
					strict: false,
					softTextRules: 'warning',
				},
			},
			null,
			2,
		),
		'00_metadata.md': `---
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "Лабораторная работа"
degree: "по дисциплине «Название дисциплины»"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
studentName: "Иванов Иван Иванович"
groupNumber: "6300 – 010302D"
topic: "Лабораторная работа"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
city: "Самара"
year: 2026
---
`,
		'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Цель лабораторной работы – проверить профиль.
`,
		'90_conclusion.md': `\\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

Выводы представлены корректно.
`,
		...overrides,
	};
}

function expectPass(name: string, files: Record<string, string>): void {
	const result = runSourcePreflight(writeReport(name, files));
	assert.equal(
		result.passed,
		true,
		result.issues.map(item => item.code).join(', '),
	);
}

function expectIssue(
	name: string,
	files: Record<string, string>,
	expectedCode: string,
): void {
	const result = runSourcePreflight(writeReport(name, files));
	assert.equal(result.passed, false, 'Expected preflight to fail');
	assert.ok(
		result.issues.some(item => item.code === expectedCode),
		`Expected issue ${expectedCode}, got ${result.issues.map(item => item.code).join(', ')}`,
	);
}

function expectWarning(
	name: string,
	files: Record<string, string>,
	expectedCode: string,
): void {
	const result = runSourcePreflight(writeReport(name, files));
	assert.equal(
		result.passed,
		true,
		'Warnings must not fail regular preflight',
	);
	assert.ok(
		result.issues.some(
			item => item.code === expectedCode && item.severity === 'warning',
		),
		`Expected warning ${expectedCode}, got ${result.issues.map(item => `${item.severity}:${item.code}`).join(', ')}`,
	);
}

function expectNoIssue(
	name: string,
	files: Record<string, string>,
	unexpectedCode: string,
): void {
	const result = runSourcePreflight(writeReport(name, files));
	assert.ok(
		!result.issues.some(item => item.code === unexpectedCode),
		`Did not expect ${unexpectedCode}, got ${result.issues.map(item => `${item.severity}:${item.code}`).join(', ')}`,
	);
}

function expectStrictIssue(
	name: string,
	files: Record<string, string>,
	expectedCode: string,
): void {
	const reportDir = writeReport(name, files);
	const result = runSourcePreflight(reportDir, { strict: true });
	assert.equal(
		result.passed,
		false,
		'Strict preflight must fail on warnings',
	);
	assert.ok(
		result.issues.some(item => item.code === expectedCode),
		`Expected strict issue ${expectedCode}, got ${result.issues.map(item => item.code).join(', ')}`,
	);
}

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

expectPass('valid-minimal', validFiles());
expectPass(
	'valid-style-preset',
	validFiles({
		'report.config.json': JSON.stringify({
			stylePreset: 'samara-template-2022',
		}),
	}),
);
expectPass(
	'referat-without-figure-table-placeholders',
	validFiles({
		'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

Отчет содержит {{PAGES}} страниц и {{SOURCES}} источников.
`,
	}),
);
expectPass('lab-without-referat-or-sources', labFiles());

expectIssue(
	'unknown-profile',
	validFiles({
		'report.config.json': JSON.stringify({ profile: 'seminar' }),
	}),
	'report-config-unknown-profile',
);

expectIssue(
	'unknown-style-preset',
	validFiles({
		'report.config.json': JSON.stringify({
			stylePreset: 'samara-template-2021',
		}),
	}),
	'report-config-unknown-style-preset',
);

expectIssue(
	'absolute-config-path',
	validFiles({
		'report.config.json': JSON.stringify({
			profile: 'nir',
			sourceDir: 'C:\\Users\\student\\report',
		}),
	}),
	'report-config-absolute-path',
);

expectIssue(
	'unknown-renderer',
	validFiles({
		'report.config.json': JSON.stringify({ renderer: 'cloud' }),
	}),
	'report-config-unknown-renderer',
);

expectIssue(
	'portable-renderer-post-build-conflict',
	validFiles({
		'report.config.json': JSON.stringify({
			renderer: 'portable',
			postBuild: { enabled: true },
		}),
	}),
	'report-config-renderer-conflict',
);

{
	const legacyDir = writeReport('legacy-post-build-renderer', validFiles());
	const legacyConfig = resolveReportConfig(legacyDir, {
		postBuild: true,
	}).config;
	assert.equal(legacyConfig.renderer, 'word');
	assert.equal(legacyConfig.postBuild.enabled, true);
	const portableConfig = resolveReportConfig(legacyDir, {
		renderer: 'portable',
	}).config;
	assert.equal(portableConfig.renderer, 'portable');
	assert.equal(portableConfig.postBuild.enabled, false);
}

expectIssue(
	'lab-citation-requires-sources',
	labFiles({
		'03_intro.md': `\\sto_structural_heading{ВВЕДЕНИЕ}

Источник используется в тексте [@smith2020].
`,
		'references.bib': `@article{smith2020,
  author = {Smith, J.},
  title = {Source},
  journal = {Journal},
  year = {2020}
}
`,
	}),
	'structural-heading-missing',
);

runBibliographyRegressionTests({
	writeReport,
	validFiles,
	expectIssue,
	expectWarning,
	expectNoIssue,
});

expectIssue(
	'manual-bibliography-content',
	validFiles({
		'91_sources.md': `\\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}

\\begin{sto_bibliography}
1 Ручной источник.
\\end{sto_bibliography}
`,
	}),
	'manual-bibliography-content',
);

expectWarning(
	'heading-final-period',
	validFiles({
		'03_intro.md': `# Заголовок с точкой.

Текст без нарушений.
`,
	}),
	'markdown-heading-final-period',
);

expectWarning(
	'heading-level-jump',
	validFiles({
		'03_intro.md': `# Раздел

### Подраздел с перескоком

Текст без нарушений.
`,
	}),
	'markdown-heading-level-jump',
);

expectIssue(
	'metadata-invalid-type',
	validFiles({
		'00_metadata.md': `---
semester: "six"
year: "2026"
---
`,
	}),
	'metadata-field-invalid-type',
);

expectWarning(
	'metadata-profile-report-type-mismatch',
	validFiles({
		'report.config.json': JSON.stringify({ profile: 'coursework' }),
		'00_metadata.md': `---
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "Лабораторная работа"
degree: "по дисциплине «Название дисциплины»"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
studentName: "Иванов Иван Иванович"
groupNumber: "6300 – 010302D"
topicPrefix: "Тема лабораторной работы"
topic: "Тема"
supervisorName: "Петров Петр Петрович"
supervisorTitle: "доцент"
city: "Самара"
year: 2026
---
`,
	}),
	'metadata-profile-report-type-mismatch',
);

expectWarning(
	'metadata-semester-out-of-range',
	validFiles({
		'00_metadata.md': `---
semester: 13
year: 2026
---
`,
	}),
	'metadata-semester-out-of-range',
);

expectWarning(
	'metadata-specialty-code-format',
	validFiles({
		'00_metadata.md': `---
specialtyCode: "010302"
---
`,
	}),
	'metadata-specialty-code-format',
);

expectIssue(
	'unsupported-env',
	validFiles({
		'03_intro.md': `\\begin{itemize}
- bad
\\end{itemize}
`,
	}),
	'unsupported-sto-environment',
);

expectIssue(
	'mismatched-env',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
- bad
\\end{sto_enum}
`,
	}),
	'mismatched-sto-environment',
);

expectIssue(
	'unclosed-env',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
- bad
`,
	}),
	'unclosed-sto-environment',
);

expectIssue(
	'raw-list',
	validFiles({
		'03_intro.md': `- raw list item
`,
	}),
	'raw-markdown-list',
);

expectIssue(
	'forbidden-list-letter',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
ё) недопустимый буквенный маркер;
\\end{sto_list}
`,
	}),
	'forbidden-list-letter-marker',
);

for (const letter of ['з', 'й', 'о', 'ч', 'ъ', 'ы', 'ь']) {
	expectIssue(
		`forbidden-list-letter-${letter}`,
		validFiles({
			'03_intro.md': `Перечень содержит:\n\\begin{sto_list}\n${letter}) недопустимый маркер.\n\\end{sto_list}\n`,
		}),
		'forbidden-list-letter-marker',
	);
}

expectIssue(
	'list-marker-extra-dot',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
1). недопустимый маркер;
\\end{sto_list}
`,
	}),
	'list-marker-extra-dot',
);

expectWarning(
	'list-intro-punctuation',
	validFiles({
		'03_intro.md': `Перед перечнем
\\begin{sto_list}
- первый элемент;
- второй элемент.
\\end{sto_list}
`,
	}),
	'list-intro-punctuation',
);

expectWarning(
	'list-intro-trailing-preposition',
	validFiles({
		'03_intro.md': `Перечень относится к:
\\begin{sto_list}
- первому элементу;
- второму элементу.
\\end{sto_list}
`,
	}),
	'list-intro-trailing-preposition',
);

expectWarning(
	'list-parenthesized-lowercase-punctuation',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
1) первый элемент.
2) второй элемент.
\\end{sto_list}
`,
	}),
	'list-item-lowercase-punctuation',
);

expectWarning(
	'list-dotted-item-case',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
1. первый элемент.
\\end{sto_list}
`,
	}),
	'list-dotted-item-case',
);

expectWarning(
	'list-dotted-item-punctuation',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
А. Первый элемент
\\end{sto_list}
`,
	}),
	'list-dotted-item-punctuation',
);

expectWarning(
	'list-final-item-punctuation',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
- первый элемент;
- второй элемент
\\end{sto_list}
`,
	}),
	'list-final-item-punctuation',
);

expectWarning(
	'list-marker-sequence-gap',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
1) первый элемент;
3) третий элемент.
\\end{sto_list}
`,
	}),
	'list-marker-sequence-gap',
);

expectWarning(
	'list-russian-marker-sequence-gap',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
а) первый элемент;
в) третий элемент.
\\end{sto_list}
`,
	}),
	'list-marker-sequence-gap',
);

expectWarning(
	'list-mixed-marker-style',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
- первый элемент;
1) второй элемент.
\\end{sto_list}
`,
	}),
	'list-mixed-marker-style',
);

expectWarning(
	'list-punctuation-warning',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
- элемент без знака
- второй элемент.
\\end{sto_list}
`,
	}),
	'list-item-lowercase-punctuation',
);

expectNoIssue(
	'list-definition-dot',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
- $O_i$ – просроченная задолженность МСП по кредитам в территории i.
- $D_i$ – совокупная задолженность МСП по кредитам в территории i.
\\end{sto_list}
`,
	}),
	'list-item-lowercase-punctuation',
);

expectNoIssue(
	'list-uppercase-semicolon',
	validFiles({
		'03_intro.md': `\\begin{sto_list}
- Ridge-регрессия – линейная модель с L2-регуляризацией;
- робастная Huber-регрессия – линейная модель.
\\end{sto_list}
`,
	}),
	'list-item-uppercase-punctuation',
);

expectWarning(
	'list-nested-final-item-period',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_list}
- первый элемент;
  а) вложенный элемент;
- второй элемент.
\\end{sto_list}
`,
	}),
	'list-final-item-punctuation',
);

expectNoIssue(
	'list-dotted-nonfinal-full-stop',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_enum}
1. Первый элемент.
2. Второй элемент.
\\end{sto_enum}
`,
	}),
	'list-item-lowercase-punctuation',
);

expectNoIssue(
	'list-parenthesized-nonfinal-comma',
	validFiles({
		'03_intro.md': `Перечень содержит:
\\begin{sto_enum}
1) первый элемент,
2) второй элемент.
\\end{sto_enum}
`,
	}),
	'list-item-lowercase-punctuation',
);

expectIssue(
	'manual-source-citation',
	validFiles({
		'03_intro.md': `Текст с ручной ссылкой [1, 2].
`,
	}),
	'manual-source-citation',
);

expectIssue(
	'bare-number-sign',
	validFiles({
		'03_intro.md': `Текст содержит знак № без числового значения.
`,
	}),
	'bare-number-sign',
);

expectIssue(
	'bare-comparison',
	validFiles({
		'03_intro.md': `Знак > используется без числового значения.
`,
	}),
	'bare-math-comparison-sign',
);

expectWarning(
	'decimal-dot-warning',
	validFiles({
		'03_intro.md': `Метрика равна 3.14 в обычном тексте.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'section-reference-with-dot',
	validFiles({
		'03_intro.md': `Формулы моделей и метрик приведены в разделе 3.5.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'heading-number-with-dot',
	validFiles({
		'03_intro.md': `## 3.5 Модельные расчеты

Описание раздела приведено без десятичных дробей.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'gost-number-with-dot',
	validFiles({
		'03_intro.md': `Общие требования приведены в ГОСТ 7.32.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'url-with-dotted-version',
	validFiles({
		'03_intro.md': `Документация доступна по адресу https://example.com/v1.2/page.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'frontmatter-quoted-decimal',
	validFiles({
		'00_metadata.md': `---
title: "3.14"
---
`,
	}),
	'straight-quotes',
);

expectNoIssue(
	'frontmatter-decimal',
	validFiles({
		'00_metadata.md': `---
title: "3.14"
---
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'code-block-quoted-decimal',
	validFiles({
		'03_intro.md': `\`\`\`json
{"value": 3.14}
\`\`\`

Текст приведен без нарушений.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'code-block-straight-quotes',
	validFiles({
		'03_intro.md': `\`\`\`json
{"value": 3.14}
\`\`\`

Текст приведен без нарушений.
`,
	}),
	'straight-quotes',
);

expectNoIssue(
	'inline-code-quoted-decimal',
	validFiles({
		'03_intro.md': `Фрагмент \`"3.14"\` приведен как технический пример.
`,
	}),
	'straight-quotes',
);

expectNoIssue(
	'inline-code-decimal',
	validFiles({
		'03_intro.md': `Фрагмент \`"3.14"\` приведен как технический пример.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'inline-math-negative-decimal',
	validFiles({
		'03_intro.md': `Расчет задан выражением $x=-3.14$.
`,
	}),
	'hyphen-negative-number',
);

expectNoIssue(
	'inline-math-decimal',
	validFiles({
		'03_intro.md': `Расчет задан выражением $x=-3.14$.
`,
	}),
	'decimal-dot',
);

expectStrictIssue(
	'strict-warning',
	validFiles({
		'03_intro.md': `Метрика равна 3.14 в обычном тексте.
`,
	}),
	'decimal-dot',
);

expectNoIssue(
	'signed-statistic-expression',
	validFiles({
		'03_intro.md': `Коэффициент равен ρ = -0,361, p < 0,001.
`,
	}),
	'hyphen-negative-number',
);

expectWarning(
	'negative-number-in-text',
	validFiles({
		'03_intro.md': `Температура составила -10 °C в начале наблюдения.
`,
	}),
	'hyphen-negative-number',
);

expectIssue(
	'caption-period',
	validFiles({
		'03_intro.md': `Показатели приведены в таблице 1.

Таблица 1 – Показатели. (@tab:period)
| A | B |
|---|---|
| 1 | 2 |
`,
	}),
	'caption-final-period',
);

expectIssue(
	'table-header-period',
	validFiles({
		'03_intro.md': `Показатели приведены в таблице 1.

Таблица 1 – Показатели (@tab:period_header)
| Показатель. | Значение |
|---|---|
| A | B |
`,
	}),
	'table-header-final-period',
);

expectIssue(
	'table-empty-cell',
	validFiles({
		'03_intro.md': `Показатели приведены в таблице 1.

Таблица 1 – Показатели (@tab:empty_cell)
| Показатель | Значение |
|---|---|
| A | |
`,
	}),
	'table-empty-source-cell',
);

expectIssue(
	'duplicate-equation-label',
	validFiles({
		'03_intro.md': `Формула @eq:x.

$$x = 1 (@eq:x)$$

$$x = 2 (@eq:x)$$
`,
	}),
	'duplicate-label',
);

expectIssue(
	'formula-star',
	validFiles({
		'03_intro.md': `Формула @eq:mul.

$$
a * b (@eq:mul)
$$
`,
	}),
	'formula-forbidden-multiplication-sign',
);

expectIssue(
	'formula-division-colon',
	validFiles({
		'03_intro.md': `Формула @eq:ratio.

$$
a : b (@eq:ratio)
$$
`,
	}),
	'formula-forbidden-division-colon',
);

expectWarning(
	'formula-bare-upright-function',
	validFiles({
		'03_intro.md': `Формула содержит функцию.

$$
y = sin x + max(a, b)
$$
`,
	}),
	'formula-bare-upright-function',
);

expectWarning(
	'formula-forbidden-raw-token',
	validFiles({
		'03_intro.md': `Формула содержит многоточие.

$$
x_1 + x_2 + ... + x_n
$$
`,
	}),
	'formula-forbidden-raw-token',
);

expectWarning(
	'formula-forbidden-raw-multiplication-token',
	validFiles({
		'03_intro.md': `Формула содержит сырой знак умножения.

$$
x × y
$$
`,
	}),
	'formula-forbidden-raw-token',
);

expectWarning(
	'formula-number-letter-cdot',
	validFiles({
		'03_intro.md': `Формула содержит лишнюю точку умножения.

$$
5 \\cdot x
$$
`,
	}),
	'formula-number-letter-cdot',
);

expectWarning(
	'formula-parenthesis-cdot',
	validFiles({
		'03_intro.md': `Формула содержит лишнюю точку умножения.

$$
x = a \\cdot (b + c)
$$
`,
	}),
	'formula-redundant-cdot',
);

expectWarning(
	'formula-vector-cdot',
	validFiles({
		'03_intro.md': `Формула содержит лишнюю точку умножения.

$$
x = a \\cdot \\vec{b}
$$
`,
	}),
	'formula-redundant-cdot',
);

expectNoIssue(
	'formula-scalar-cdot',
	validFiles({
		'03_intro.md': `Формула содержит произведение величин.

$$
x = a \\cdot b
$$
`,
	}),
	'formula-redundant-cdot',
);

expectWarning(
	'formula-period-before-where',
	validFiles({
		'03_intro.md': `Формула @eq:period_where.

$$
x = y. (@eq:period_where)
$$

где $x$ – первая величина.
`,
	}),
	'formula-period-before-where',
);

expectWarning(
	'formula-where-definition-separator',
	validFiles({
		'03_intro.md': `Формула @eq:where_separator.

$$
x = y (@eq:where_separator)
$$

где $x$ – первая величина
$y$ – вторая величина.
`,
	}),
	'formula-where-definition-separator',
);

expectWarning(
	'formula-where-final-period',
	validFiles({
		'03_intro.md': `Формула @eq:where_period.

$$
x = y (@eq:where_period)
$$

где $x$ – первая величина
`,
	}),
	'formula-where-final-period',
);

expectWarning(
	'formula-line-break-after-division',
	validFiles({
		'03_intro.md': `Формула содержит перенос.

$$
x = a / \\\\
b
$$
`,
	}),
	'formula-line-break-after-division',
);

expectWarning(
	'consecutive-formula-punctuation',
	validFiles({
		'03_intro.md': `Две формулы приведены подряд.

$$
a = b
$$

$$
c = d
$$
`,
	}),
	'consecutive-formula-punctuation',
);

expectWarning(
	'formula-break-operator-repeat',
	validFiles({
		'03_intro.md': [
			'Формула содержит перенос.',
			'',
			'$$',
			'x = a + ' + '\\\\',
			'b',
			'$$',
		].join('\n'),
	}),
	'formula-line-break-operator-not-repeated',
);

expectIssue(
	'formula-decimal-comma',
	validFiles({
		'03_intro.md': [
			'Формула содержит десятичную дробь.',
			'',
			'$$',
			'x = 1.5',
			'$$',
		].join('\n'),
	}),
	'formula-decimal-dot',
);

expectIssue(
	'unused-equation-label',
	validFiles({
		'03_intro.md': `Нумерованная формула приведена без ссылки в тексте.

$$
x = 1 (@eq:unused)
$$
`,
	}),
	'unused-equation-label',
);

expectIssue(
	'unknown-reference',
	validFiles({
		'03_intro.md': `Ссылка на неизвестный рисунок @fig:missing.
`,
	}),
	'unknown-reference-label',
);

expectWarning(
	'bibliography-url-missing-urldate',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с электронным источником [@web2026].
`,
		'references.bib': `@misc{web2026,
  title = {Electronic source},
  year = {2026},
  url = {https://example.com}
}
`,
	}),
	'bibliography-url-missing-urldate',
);

expectWarning(
	'bibliography-urldate-invalid-format',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с электронным источником [@web2027].
`,
		'references.bib': `@misc{web2027,
  title = {Electronic source},
  year = {2027},
  url = {https://example.com},
  urldate = {08.06.2026}
}
`,
	}),
	'bibliography-urldate-invalid-format',
);

expectWarning(
	'bibliography-url-missing-protocol',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с электронным источником [@web2028].
`,
		'references.bib': `@misc{web2028,
  title = {Electronic source},
  year = {2028},
  url = {example.com},
  urldate = {2026-06-08}
}
`,
	}),
	'bibliography-url-missing-protocol',
);

expectWarning(
	'bibliography-urldate-in-future',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с электронным источником [@futureWeb].
`,
		'references.bib': `@misc{futureWeb,
  title = {Electronic source},
  year = {2028},
  url = {https://example.com},
  urldate = {2999-01-01}
}
`,
	}),
	'bibliography-urldate-in-future',
);

expectNoIssue(
	'bibliography-publication-and-access-year-can-match',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с документацией [@docsSameYear].
`,
		'references.bib': `@misc{docsSameYear,
   title = {Documentation},
   website = {Example : [сайт]},
   year = {2026},
   url = {https://example.com/docs},
   urldate = {2026-06-26}
}
`,
	}),
	'bibliography-url-year-matches-urldate',
);

expectNoIssue(
	'bibliography-publication-year-differs-from-urldate',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с документацией [@docsOlderYear].
`,
		'references.bib': `@misc{docsOlderYear,
   title = {Documentation},
   website = {Example : [сайт]},
   year = {2025},
   url = {https://example.com/docs},
   urldate = {2026-06-26}
}
`,
	}),
	'bibliography-url-year-matches-urldate',
);

expectWarning(
	'bibliography-doi-url',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст со статьей [@doiUrl].
`,
		'references.bib': `@article{doiUrl,
  author = {Smith, J.},
  title = {Article},
  journal = {Journal},
  year = {2026},
  pages = {1--10},
  doi = {https://doi.org/10.1000/example},
  langid = {english}
}
`,
	}),
	'bibliography-doi-url',
);

expectWarning(
	'bibliography-doi-invalid-prefix',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст со статьей [@badDoi].
`,
		'references.bib': `@article{badDoi,
  author = {Smith, J.},
  title = {Article},
  journal = {Journal},
  year = {2026},
  pages = {1--10},
  doi = {abc/example},
  langid = {english}
}
`,
	}),
	'bibliography-doi-invalid-prefix',
);

expectNoIssue(
	'bibliography-journal-name-does-not-prove-resource-type',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с working paper [@nberArticle].
`,
		'references.bib': `@article{nberArticle,
  author = {Smith, J.},
  title = {Working paper},
  journal = {NBER Working Paper Series},
  year = {2026},
  pages = {1--10},
  langid = {english}
}
`,
	}),
	'bibliography-article-preprint-type',
);

expectNoIssue(
	'bibliography-script-does-not-prove-language',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с английской статьей [@englishNoLang].
`,
		'references.bib': `@article{englishNoLang,
  author = {Smith, J.},
  title = {Credit scoring model},
  journal = {Journal of Finance},
  year = {2026},
  pages = {1--10}
}
`,
	}),
	'bibliography-latin-entry-missing-langid',
);

expectWarning(
	'bibliography-book-pages-range',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с книгой [@bookRange].
`,
		'references.bib': `@book{bookRange,
  author = {Иванов, И. И.},
  title = {Книга},
  address = {Самара},
  publisher = {Издательство},
  year = {2026},
  pages = {10--20}
}
`,
	}),
	'bibliography-book-pages-range',
);

runStructureReferenceTests({
	writeReport,
	validFiles,
	expectIssue,
	expectWarning,
	expectNoIssue,
});

console.log('Source preflight tests passed.');
