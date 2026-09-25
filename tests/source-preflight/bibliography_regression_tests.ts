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

export function runBibliographyRegressionTests({
	writeReport,
	validFiles,
	expectIssue,
	expectWarning,
	expectNoIssue,
}: TestHarness): void {
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

	const bibliographyMetadata = `---
bibliography: "references.bib"
---
`;

	{
		const reportDir = writeReport(
			'bibliography-missing-title-is-error',
			validFiles({
				'00_metadata.md': bibliographyMetadata,
				'03_intro.md': 'Источник [@untitled].\n',
				'references.bib':
					'@online{untitled, url = {https://example.com}, urldate = {2025-06-01}}\n',
			}),
		);
		const result = runSourcePreflight(reportDir);
		assert.ok(
			result.issues.some(
				item =>
					item.code === 'bibliography-required-field-missing' &&
					item.severity === 'error',
			),
		);
	}

	expectNoIssue(
		'bibliography-nested-multiline-fields',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@nested, с. 12].\n',
			'references.bib': `@book{nested,
  author = {{Иванов, И. И.}},
  title = {Книга с {вложенным}
    названием},
  address = {Самара},
  publisher = {Издательство},
  year = {2025},
  pages = {200},
  url = {https://example.com/book},
  urldate = {2025-06-01}
}
`,
		}),
		'unknown-bibtex-key',
	);

	expectIssue(
		'bibliography-url-with-line-break',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@wrappedUrl].\n',
			'references.bib': `@online{wrappedUrl,
  title = {Источник},
  url = {https://example.com/
    page},
  urldate = {2025-06-01}
}
`,
		}),
		'bibliography-url-contains-whitespace',
	);

	expectIssue(
		'bibliography-brace-only-title',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@emptyTitle].\n',
			'references.bib':
				'@online{emptyTitle, title = {{}}, url = {https://example.com}, urldate = {2025-06-01}}\n',
		}),
		'bibliography-required-field-missing',
	);

	expectNoIssue(
		'bibliography-multiline-urldate',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@multiline].\n',
			'references.bib': `@misc{multiline,
  title = {Источник},
  year = {2025},
  url = {https://example.com},
  urldate =
    {2025-06-01}
}
`,
		}),
		'bibliography-url-missing-urldate',
	);

	expectNoIssue(
		'bibliography-print-misc-url-is-conditional',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@printMisc].\n',
			'references.bib': `@misc{printMisc,
  author = {Иванов, И. И.},
  title = {Печатный материал},
  year = {2025}
}
`,
		}),
		'bibliography-required-field-missing',
	);

	expectWarning(
		'bibliography-electronic-misc-needs-url',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Сетевой источник [@networkMisc].\n',
			'references.bib': `@misc{networkMisc,
  title = {Сетевой материал},
  howpublished = {сайт организации}
}
`,
		}),
		'bibliography-required-field-missing',
	);

	for (const entryType of ['misc', 'online', 'inonline']) {
		expectNoIssue(
			`bibliography-${entryType}-year-is-conditional`,
			validFiles({
				'00_metadata.md': bibliographyMetadata,
				'03_intro.md': 'Сетевой источник [@noPublicationDate].\n',
				'references.bib': `@${entryType}{noPublicationDate,
  title = {Сетевой ресурс},
  website = {Сайт организации},
  url = {https://example.com/resource},
  urldate = {2025-06-01}
}
`,
			}),
			'bibliography-required-field-missing',
		);
	}

	expectWarning(
		'bibliography-invalid-calendar-date',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@badCalendar].\n',
			'references.bib': `@online{badCalendar,
  title = {Ресурс},
  year = {2025},
  url = {https://example.com},
  urldate = {2025-02-30}
}
`,
		}),
		'bibliography-urldate-invalid-format',
	);

	expectIssue(
		'bibliography-duplicate-key',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@duplicate].\n',
			'references.bib': `@misc{duplicate, title = {Первый}, year = {2025}, url = {https://example.com}}
@misc{duplicate, title = {Второй}, year = {2025}, url = {https://example.org}}
`,
		}),
		'bibliography-duplicate-key',
	);

	expectIssue(
		'bibliography-malformed-entry',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@broken].\n',
			'references.bib': '@misc{broken, title = {Незакрытая запись}\n',
		}),
		'bibliography-parse-error',
	);

	expectIssue(
		'bibliography-malformed-citation',
		validFiles({
			'03_intro.md': 'Источник [@book;].\n',
		}),
		'citation-invalid-syntax',
	);
	expectIssue(
		'bibliography-empty-citation',
		validFiles({ '03_intro.md': 'Пустая отсылка [@].\n' }),
		'citation-invalid-syntax',
	);
}
