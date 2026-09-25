import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBibliographyPath } from '@/shared/lib/bibliography-path';
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
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-bib-path-'));
	try {
		const sourceDir = path.join(root, 'report');
		fs.mkdirSync(sourceDir);
		const sourceBib = path.join(sourceDir, 'references.bib');
		const workspaceBib = path.join(root, 'references.bib');
		fs.writeFileSync(sourceBib, '@book{source, title={Source}}');
		assert.equal(
			resolveBibliographyPath('references.bib', sourceDir, root),
			sourceBib,
		);
		fs.writeFileSync(workspaceBib, '@book{workspace, title={Workspace}}');
		assert.throws(
			() => resolveBibliographyPath('references.bib', sourceDir, root),
			/ambiguous/,
		);
		assert.equal(
			resolveBibliographyPath('report/references.bib', sourceDir, root),
			sourceBib,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
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

	expectNoIssue(
		'bibliography-compiled-book-responsibility',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Методические указания [@compiledGuide].\n',
			'references.bib': `@book{compiledGuide,
  title = {Внешнее описание программных комплексов},
  note = {сост. А. В. Куприянов, Д. В. Кирш},
  address = {Самара},
  publisher = {Самарский университет},
  year = {2020},
  pages = {20}
}
`,
		}),
		'bibliography-required-field-missing',
	);
	expectNoIssue(
		'bibliography-typed-compiler',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Методические указания [@typedCompiler].\n',
			'references.bib': `@book{typedCompiler,
  title = {Внешнее описание программных комплексов},
  compiler = {Куприянов, А. В. and Кирш, Д. В.},
  address = {Самара},
  publisher = {Самарский университет},
  year = {2020},
  pages = {20}
}
`,
		}),
		'bibliography-required-field-missing',
	);
	expectWarning(
		'bibliography-book-without-responsibility',
		validFiles({
			'00_metadata.md': bibliographyMetadata,
			'03_intro.md': 'Источник [@uncreditedBook].\n',
			'references.bib': `@book{uncreditedBook,
  title = {Методические указания},
  note = {Библиогр.: с. 19},
  address = {Самара},
  publisher = {Самарский университет},
  year = {2020},
  pages = {20}
}
`,
		}),
		'bibliography-required-field-missing',
	);

	{
		const reportDir = writeReport(
			'bibliography-report-entry',
			validFiles({
				'00_metadata.md': bibliographyMetadata,
				'03_intro.md': 'Аналитический отчёт [@bankReport].\n',
				'references.bib': `@report{bankReport,
  title = {Аналитический обзор},
  author = {{Банк России}},
  institution = {Банк России},
  type = {информационно-аналитические материалы},
  year = {2024},
  url = {https://example.org/report.pdf},
  urldate = {2025-07-01}
}
`,
			}),
		);
		const result = runSourcePreflight(reportDir);
		assert.equal(
			result.passed,
			true,
			result.issues
				.map(item => `${item.code}: ${item.message}`)
				.join('\n'),
		);
	}

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

	for (const entrysubtype of ['online', 'electronic']) {
		expectIssue(
			`bibliography-${entrysubtype}-misc-needs-url`,
			validFiles({
				'00_metadata.md': bibliographyMetadata,
				'03_intro.md': 'Сетевой источник [@networkMisc].\n',
				'references.bib': `@misc{networkMisc,
  title = {Сетевой материал},
  entrysubtype = {${entrysubtype}}
}
`,
			}),
			'bibliography-required-field-missing',
		);
	}

	for (const entryType of ['online', 'inonline']) {
		expectIssue(
			`bibliography-${entryType}-needs-url`,
			validFiles({
				'00_metadata.md': bibliographyMetadata,
				'03_intro.md': 'Сетевой источник [@network].\n',
				'references.bib': `@${entryType}{network,
  title = {Сетевой материал},
  website = {Сайт организации}
}
`,
			}),
			'bibliography-required-field-missing',
		);
	}

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
