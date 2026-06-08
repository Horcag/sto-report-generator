import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runSourcePreflight } from '@/shared/lib/source-preflight';

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
expectPass('lab-without-referat-or-sources', labFiles());

expectIssue(
	'unknown-profile',
	validFiles({
		'report.config.json': JSON.stringify({ profile: 'seminar' }),
	}),
	'report-config-unknown-profile',
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

expectIssue(
	'unknown-bibtex-key',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с неизвестным источником [@missing2020].
`,
		'references.bib': `@article{known2020,
  author = {Smith, J.},
  title = {Source},
  journal = {Journal},
  year = {2020}
}
`,
	}),
	'unknown-bibtex-key',
);

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
	'bibliography-book-required-field',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с книгой [@book2026].
`,
		'references.bib': `@book{book2026,
  author = {Иванов, И. И.},
  title = {Книга},
  year = {2026},
  address = {Самара},
  pages = {120}
}
`,
	}),
	'bibliography-required-field-missing',
);

expectWarning(
	'bibliography-article-required-field',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст со статьей [@article2026].
`,
		'references.bib': `@article{article2026,
  author = {Иванов, И. И.},
  title = {Статья},
  journal = {Журнал},
  year = {2026}
}
`,
	}),
	'bibliography-required-field-missing',
);

expectWarning(
	'bibliography-inproceedings-required-field',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с материалами конференции [@conf2026].
`,
		'references.bib': `@inproceedings{conf2026,
  author = {Иванов, И. И.},
  title = {Доклад},
  year = {2026},
  pages = {10--12}
}
`,
	}),
	'bibliography-required-field-missing',
);

expectNoIssue(
	'unused-broken-bibliography-entry',
	validFiles({
		'00_metadata.md': `---
bibliography: "references.bib"
---
`,
		'03_intro.md': `Текст с использованной статьей [@used2026].
`,
		'references.bib': `@article{used2026,
  author = {Иванов, И. И.},
  title = {Статья},
  journal = {Журнал},
  year = {2026},
  pages = {10--12}
}

@book{unusedBroken2026,
  title = {Сломанная книга}
}
`,
	}),
	'bibliography-required-field-missing',
);

expectWarning(
	'application-without-reference',
	validFiles({
		'92_appendix.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}

Материалы приложения.
`,
	}),
	'application-without-reference',
);

expectWarning(
	'application-object-numbering',
	validFiles({
		'03_intro.md': `Дополнительные данные приведены в приложении А. Неверный рисунок приложения показан на рисунке 1.
`,
		'92_appendix.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}

Рисунок 1 – Неверная нумерация приложения
`,
	}),
	'application-object-numbering',
);

expectIssue(
	'application-label-duplicate',
	validFiles({
		'03_intro.md': `Дополнительные данные приведены в приложении А.
`,
		'92_appendix_a.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}

Материалы приложения.
`,
		'93_appendix_a2.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}

Материалы второго приложения.
`,
	}),
	'application-label-duplicate',
);

expectIssue(
	'structure-missing',
	{
		'00_metadata.md': `---
title: Test
---
`,
		'01_referat.md': `\\sto_structural_heading{РЕФЕРАТ}

Отчет содержит {{PAGES}} страниц, {{FIGURES}} рисунков, {{TABLES}} таблиц и {{SOURCES}} источников.
`,
	},
	'structural-heading-missing',
);

expectIssue(
	'missing-image',
	validFiles({
		'03_intro.md': `Рисунок 1 показывает пример.

![Нет файла](images/missing.png)

Рисунок 1 – Нет файла (@fig:missing_image)
`,
	}),
	'missing-image',
);

const imageDir = writeReport(
	'relative-image',
	validFiles({
		'03_intro.md': `Рисунок 1 показывает пример.

![Есть файл](images/ok.png)

Рисунок 1 – Есть файл (@fig:ok)
`,
		'images/ok.png': 'not a real png but exists for source preflight',
	}),
);
const imageResult = runSourcePreflight(imageDir);
assert.equal(
	imageResult.passed,
	true,
	imageResult.issues
		.map(item => `${item.code}:${item.file ?? ''}`)
		.join(', '),
);

console.log('Source preflight tests passed.');
