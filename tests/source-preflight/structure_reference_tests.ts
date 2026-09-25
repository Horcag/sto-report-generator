import assert from 'node:assert/strict';

import { runSourcePreflight } from '@/shared/lib/source-preflight';

type Files = Record<string, string>;

interface TestHarness {
	writeReport: (name: string, files: Files) => string;
	validFiles: (overrides?: Files) => Files;
	expectIssue: (name: string, files: Files, code: string) => void;
	expectWarning: (name: string, files: Files, code: string) => void;
	expectNoIssue: (name: string, files: Files, code: string) => void;
}

export function runStructureReferenceTests({
	writeReport,
	validFiles,
	expectIssue,
	expectWarning,
	expectNoIssue,
}: TestHarness): void {
	expectIssue(
		'structural-heading-final-period',
		validFiles({
			'03_intro.md': '\\sto_structural_heading{ВВЕДЕНИЕ.}\n',
		}),
		'structural-heading-final-period',
	);

	expectNoIssue(
		'structural-heading-internal-period',
		validFiles({
			'03_intro.md': '\\sto_structural_heading{ВВЕДЕНИЕ. ЦЕЛЬ РАБОТЫ}\n',
		}),
		'structural-heading-final-period',
	);

	expectIssue(
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

	expectIssue(
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

	expectIssue(
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
	expectIssue(
		'explicit-appendix-without-reference',
		validFiles({
			'92_appendix.md': `\\sto_appendix{А}{Расчётные данные}\n`,
		}),
		'application-without-reference',
	);
	expectIssue(
		'appendix-reference-in-code-is-ignored',
		validFiles({
			'03_intro.md': '```tex\n\\sto_appendix_ref{А}\n```\n',
			'92_appendix.md': `\\sto_appendix{А}{Расчётные данные}\n`,
		}),
		'application-without-reference',
	);
	expectIssue(
		'explicit-appendix-reference-unknown',
		validFiles({
			'03_intro.md': `Данные приведены в \\sto_appendix_ref{Б}.\n`,
			'92_appendix.md': `\\sto_appendix{А}{Расчётные данные}\n`,
		}),
		'application-reference-unknown',
	);
	expectIssue(
		'explicit-appendix-reference-after-heading',
		validFiles({
			'92_appendix.md': `\\sto_appendix{А}{Расчётные данные}\n\nДанные приведены в \\sto_appendix_ref{А}.\n`,
		}),
		'application-reference-after-heading',
	);
	expectIssue(
		'only-appendix-must-be-a',
		validFiles({
			'03_intro.md': `Данные приведены в \\sto_appendix_ref{Б}.\n`,
			'92_appendix.md': `\\sto_appendix{Б}{Расчётные данные}\n`,
		}),
		'application-label-order',
	);

	expectIssue(
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
		'application-title-period',
		validFiles({
			'03_intro.md': `Дополнительные данные приведены в приложении А.\n`,
			'92_appendix.md': `\\sto_appendix{А}{Расчётные данные.}\n`,
		}),
		'application-title-format',
	);
	const explicitAppendix = runSourcePreflight(
		writeReport(
			'explicit-appendix-valid',
			validFiles({
				'03_intro.md': `Дополнительные данные приведены в \\sto_appendix_ref{А} на рисунке А.1.\n`,
				'92_appendix.md': `\\sto_appendix{А}{Расчётные данные}\n\nРисунок А.1 – Схема (@fig:app)\n`,
			}),
		),
	);
	assert.ok(
		!explicitAppendix.issues.some(item => item.severity === 'error'),
		explicitAppendix.issues
			.filter(item => item.severity === 'error')
			.map(item => item.code)
			.join(', '),
	);
	assert.ok(
		!explicitAppendix.issues.some(
			item => item.code === 'application-without-reference',
		),
	);

	const appendixReferences = runSourcePreflight(
		writeReport(
			'appendix-reference-order-valid',
			validFiles({
				'03_intro.md': `В приложении А показаны данные на рисунке А.1 и в таблице А.1; формула @eq:app вычисляет итог. Примечание 1 поясняет данные.\n`,
				'92_appendix.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}\n\nРисунок А.1 – Схема (@fig:app)\n\nТаблица А.1 – Данные (@tab:app)\n\n$$x=1 (@eq:app)$$\n\nПримечание 1 – Пояснение.\n`,
			}),
		),
	);
	const sentenceEndReference = runSourcePreflight(
		writeReport(
			'scaffold-table-reference-with-period',
			validFiles({
				'03_intro.md': `Исходные данные приведены в таблице 1.\n\nТаблица 1 – Исходные данные (@tab:input)\n`,
			}),
		),
	);
	assert.ok(
		!sentenceEndReference.issues.some(
			item => item.code === 'table-before-reference',
		),
		'An ordinary scaffold sentence ending in "таблице 1." must count as the first reference.',
	);
	assert.equal(
		appendixReferences.issues.filter(item => item.severity === 'error')
			.length,
		0,
		appendixReferences.issues
			.filter(item => item.severity === 'error')
			.map(item => item.code)
			.join(', '),
	);

	expectIssue(
		'appendix-number-gap',
		validFiles({
			'03_intro.md': `Данные приведены в приложении А на рисунке А.2.\n`,
			'92_appendix.md': `\\sto_structural_heading{ПРИЛОЖЕНИЕ А}\n\nРисунок А.2 – Схема (@fig:gap)\n`,
		}),
		'application-object-numbering',
	);
	expectIssue(
		'unknown-complex-number',
		validFiles({ '03_intro.md': `Данные на рисунке А.9 отсутствуют.\n` }),
		'unknown-object-number',
	);
	expectIssue(
		'unknown-section-local-number',
		validFiles({ '03_intro.md': `Данные на рисунке 2.9 отсутствуют.\n` }),
		'unknown-object-number',
	);
	expectIssue(
		'figure-out-of-order',
		validFiles({
			'03_intro.md': `На рисунке 2 приведена схема.\n\nРисунок 2 – Схема (@fig:second)\n`,
		}),
		'object-number-sequence',
	);
	const sectionLocal = runSourcePreflight(
		writeReport(
			'section-local-figure-and-table-numbering',
			validFiles({
				'04_sections.md': `# 1 Первый раздел\n\nНа рисунке 1.1 и в таблице 1.1 показаны данные.\n\nРисунок 1.1 – Схема (@fig:first)\n\nТаблица 1.1 – Данные (@tab:first)\n\n# 2 Второй раздел\n\nНа рисунке 2.1 и в таблице 2.1 показаны новые данные.\n\nРисунок 2.1 – Другая схема (@fig:second)\n\nТаблица 2.1 – Другие данные (@tab:second)\n`,
			}),
		),
	);
	assert.deepEqual(
		sectionLocal.issues
			.filter(item => item.severity === 'error')
			.map(item => item.code),
		[],
	);
	const continuous = runSourcePreflight(
		writeReport(
			'continuous-figure-and-table-numbering',
			validFiles({
				'04_sections.md': `# 1 Первый раздел\n\nНа рисунке 1 и в таблице 1 показаны данные.\n\nРисунок 1 – Схема (@fig:first)\n\nТаблица 1 – Данные (@tab:first)\n\n# 2 Второй раздел\n\nНа рисунке 2 и в таблице 2 показаны новые данные.\n\nРисунок 2 – Другая схема (@fig:second)\n\nТаблица 2 – Другие данные (@tab:second)\n`,
			}),
		),
	);
	assert.deepEqual(
		continuous.issues
			.filter(item => item.severity === 'error')
			.map(item => item.code),
		[],
	);
	expectIssue(
		'section-local-figure-gap',
		validFiles({
			'04_sections.md': `# 1 Первый раздел\n\nНа рисунке 1.1 показана схема.\n\nРисунок 1.1 – Схема (@fig:first)\n\n# 2 Второй раздел\n\nНа рисунке 2.2 показана новая схема.\n\nРисунок 2.2 – Новая схема (@fig:second)\n`,
		}),
		'object-number-sequence',
	);
	expectIssue(
		'mixed-table-numbering-schemes',
		validFiles({
			'04_sections.md': `# 1 Первый раздел\n\nВ таблице 1 приведены данные.\n\nТаблица 1 – Данные (@tab:first)\n\nВ таблице 1.2 приведены новые данные.\n\nТаблица 1.2 – Новые данные (@tab:second)\n`,
		}),
		'object-number-sequence',
	);
	expectIssue(
		'continuous-table-gap-across-sections',
		validFiles({
			'04_sections.md': `# 1 Первый раздел\n\nВ таблице 1 приведены данные.\n\nТаблица 1 – Данные (@tab:first)\n\n# 2 Второй раздел\n\nВ таблице 3 приведены новые данные.\n\nТаблица 3 – Новые данные (@tab:third)\n`,
		}),
		'object-number-sequence',
	);
	expectIssue(
		'single-section-numbered-figure',
		validFiles({
			'04_sections.md': `# 1 Раздел\n\nНа рисунке 1.1 показана схема.\n\nРисунок 1.1 – Схема (@fig:only)\n`,
		}),
		'single-object-number',
	);
	expectIssue(
		'single-section-numbered-table',
		validFiles({
			'04_sections.md': `# 1 Раздел\n\nВ таблице 1.1 приведены данные.\n\nТаблица 1.1 – Данные (@tab:only)\n`,
		}),
		'single-object-number',
	);
	expectNoIssue(
		'single-main-table-and-figure-without-titles',
		validFiles({
			'03_intro.md': `Схема приведена на рисунке 1, а значения в таблице 1.\n\nРисунок 1\n\nТаблица 1\n`,
		}),
		'single-object-number',
	);
	expectIssue(
		'note-without-first-reference',
		validFiles({ '03_intro.md': `Примечание 1 – Уточнение.\n` }),
		'note-before-reference',
	);
	expectIssue(
		'unknown-note-number',
		validFiles({ '03_intro.md': `В примечании 2 данные отсутствуют.\n` }),
		'unknown-object-number',
	);
	expectIssue(
		'wrong-caption-label-kind',
		validFiles({
			'03_intro.md': `Рисунок 1 показывает схему.\n\nРисунок 1 – Схема (@tab:wrong)\n`,
		}),
		'object-label-kind',
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

	for (const [type, fields] of Object.entries({
		patent: 'title = {Устройство}, country = {RU}, author = {Иванов, И. И.}, year = {2020}',
		phdthesis:
			'title = {Исследование}, author = {Иванов, И. И.}, type = {дис. канд. наук}, address = {Самара}, year = {2020}, pages = {100}',
		standard: 'title = {Правила оформления}, year = {2020}',
		inonline:
			'title = {Раздел сайта}, year = {2020}, url = {https://example.org}, urldate = {2024-01-01}',
	})) {
		const expectMissing = expectIssue;
		expectMissing(
			`bibliography-${type}-required-field`,
			validFiles({
				'03_intro.md': `Использован источник [@special].\n`,
				'references.bib': `@${type}{special,\n  ${fields.replaceAll(/, (?=[a-z]+ =)/g, ',\n  ')}\n}\n`,
			}),
			'bibliography-required-field-missing',
		);
	}

	const completeSpecialBibliography = validFiles({
		'03_intro.md': 'Источники: [@patent; @thesis; @standard; @sitePart].\n',
		'references.bib': `@patent{patent,
  title = {Устройство},
  number = {123456},
  country = {RU},
  holder = {Университет},
  year = {2020}
}
@phdthesis{thesis,
  title = {Исследование},
  author = {Иванов, И. И.},
  type = {дис. канд. наук},
  school = {Университет},
  location = {Самара},
  year = {2020},
  numpages = {100}
}
@standard{standard,
  number = {ГОСТ Р 123-2020},
  title = {Правила оформления},
  year = {2020}
}
@inonline{sitePart,
  title = {Раздел сайта},
  website = {Университет},
  year = {2020},
  url = {https://example.org},
  urldate = {2024-01-01}
}
`,
	});
	expectNoIssue(
		'bibliography-special-complete-fields',
		completeSpecialBibliography,
		'bibliography-required-field-missing',
	);
	expectNoIssue(
		'bibliography-special-supported-types',
		completeSpecialBibliography,
		'bibliography-unsupported-type',
	);

	expectIssue(
		'bibliography-unsupported-type',
		validFiles({
			'03_intro.md': 'Использован источник [@program].\n',
			'references.bib': '@software{program, title = {Программа}}\n',
		}),
		'bibliography-unsupported-type',
	);
}
