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

expectStrictIssue(
	'strict-warning',
	validFiles({
		'03_intro.md': `Метрика равна 3.14 в обычном тексте.
`,
	}),
	'decimal-dot',
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
	'unknown-reference',
	validFiles({
		'03_intro.md': `Ссылка на неизвестный рисунок @fig:missing.
`,
	}),
	'unknown-reference-label',
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
