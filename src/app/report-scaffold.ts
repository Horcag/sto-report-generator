import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ScaffoldReportOptions {
	slug: string;
	cwd?: string;
	dir?: string;
	reportsRoot?: string;
	title?: string;
	reportType?: string;
	studentName?: string;
	groupNumber?: string;
	supervisorName?: string;
	initGit?: boolean;
}

export interface ScaffoldReportResult {
	targetDir: string;
	files: string[];
	gitInitialized: boolean;
}

const REPORT_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const TEX_BEGIN = '\\' + 'begin';
const TEX_END = '\\' + 'end';

function toPosixPath(value: string): string {
	return value.split(path.sep).join('/');
}

function assertValidSlug(slug: string): void {
	if (!REPORT_SLUG_PATTERN.test(slug)) {
		throw new Error(
			`Invalid report slug "${slug}". Use ASCII letters, digits, underscores or hyphens.`,
		);
	}
}

function resolveTargetDir(options: ScaffoldReportOptions): string {
	const cwd = options.cwd ?? process.cwd();
	if (options.dir) {
		return path.resolve(cwd, options.dir);
	}
	return path.resolve(cwd, options.reportsRoot ?? 'reports', options.slug);
}

function writeTextFile(
	targetDir: string,
	relativePath: string,
	content: string,
	writtenFiles: string[],
): void {
	const filePath = path.join(targetDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content.replaceAll('\n', '\r\n'), 'utf8');
	writtenFiles.push(relativePath);
}

function ensureDirectoryIsEmpty(targetDir: string): void {
	if (!fs.existsSync(targetDir)) {
		return;
	}

	const entries = fs.readdirSync(targetDir).filter(entry => entry !== '.git');
	if (entries.length > 0) {
		throw new Error(`Target report directory is not empty: ${targetDir}`);
	}
}

function initLocalGit(targetDir: string): boolean {
	const result = spawnSync('git', ['init'], {
		cwd: targetDir,
		encoding: 'utf8',
		shell: false,
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || 'git init failed');
	}
	return true;
}

function metadataTemplate(
	options: ScaffoldReportOptions,
	bibliographyPath: string,
): string {
	const year = new Date().getFullYear();
	return String.raw`---
department: "Институт информатики и кибернетики"
subdepartment: "Кафедра технической кибернетики"
reportType: "${options.reportType ?? 'Отчет о научно-исследовательской работе'}"
degree: "бакалавра"
semester: 6
specialtyCode: "01.03.02"
specialtyName: "Прикладная математика и информатика"
profileName: "Искусственный интеллект и компьютерные науки"
studentName: "${options.studentName ?? 'Фамилия Имя Отчество'}"
groupNumber: "${options.groupNumber ?? '0000 – 000000D'}"
topic: "${options.title ?? 'Название темы'}"
supervisorName: "${options.supervisorName ?? 'Фамилия Имя Отчество'}"
supervisorTitle: "ученая степень, должность"
city: "Самара"
year: ${year}
bibliography: "${bibliographyPath}"
---
`;
}

function reportReadmeTemplate(slug: string, reportPath: string): string {
	return String.raw`# ${slug}

Локальная папка отчета создана генератором STO Report Generator.

## Быстрый цикл

Команды запускаются из корня генератора:

    npm run check:source -- ${reportPath}
    npm run generate:report -- ${reportPath} --post-build --validate

Файлы отчета собираются по алфавиту. Сохраняйте смысловые блоки в отдельных Markdown-файлах и не переносите весь отчет в один файл.

## Что редактировать первым

- 00_metadata.md: титульный лист и путь к bibliography.
- 03_intro.md: цель, задачи, объект, предмет.
- 10_methodology.md, 20_data.md, 30_results.md: основная часть.
- 90_conclusion.md: выводы.
- references.bib: BibTeX-источники.

DOCX/PDF, временные распаковки и rendered-страницы игнорируются локальным git.
`;
}

function reportGitignoreTemplate(): string {
	return String.raw`*.docx
*.pdf
~$*.doc*
~$*.dot*
build/
output/
rendered/
.temp*/
*_unpacked/
__pycache__/
.venv/
.DS_Store
`;
}

function reportConfigTemplate(slug: string): string {
	return `${JSON.stringify(
		{
			sourceDir: '.',
			outputDocx: `build/${slug}.docx`,
			postBuild: {
				enabled: true,
				exportPdf: true,
			},
			validate: {
				enabled: true,
				unpackDir: '.temp_docx',
			},
		},
		null,
		2,
	)}\n`;
}

export function scaffoldReport(
	options: ScaffoldReportOptions,
): ScaffoldReportResult {
	assertValidSlug(options.slug);

	const cwd = options.cwd ?? process.cwd();
	const targetDir = resolveTargetDir(options);
	ensureDirectoryIsEmpty(targetDir);
	fs.mkdirSync(targetDir, { recursive: true });

	const reportPath = toPosixPath(path.relative(cwd, targetDir)) || '.';
	const bibliographyPath = toPosixPath(
		path.relative(cwd, path.join(targetDir, 'references.bib')),
	);
	const files: string[] = [];

	writeTextFile(targetDir, '.gitignore', reportGitignoreTemplate(), files);
	writeTextFile(
		targetDir,
		'README.md',
		reportReadmeTemplate(options.slug, reportPath),
		files,
	);
	writeTextFile(
		targetDir,
		'report.config.json',
		reportConfigTemplate(options.slug),
		files,
	);
	writeTextFile(
		targetDir,
		'00_metadata.md',
		metadataTemplate(options, bibliographyPath),
		files,
	);
	writeTextFile(
		targetDir,
		'01_referat.md',
		String.raw`\sto_structural_heading{РЕФЕРАТ}

Отчет содержит {{PAGES}} страниц, {{FIGURES}} рисунков, {{TABLES}} таблиц и {{SOURCES}} использованных источников.

Ключевые слова: ключевое слово 1; ключевое слово 2; ключевое слово 3.

Цель работы – сформулировать цель исследования.

В работе решены следующие задачи:

${TEX_BEGIN}{sto_list}
- описана предметная область;
- подготовлены данные и методы;
- получены и интерпретированы результаты.
${TEX_END}{sto_list}
`,
		files,
	);
	writeTextFile(
		targetDir,
		'02_toc.md',
		String.raw`\sto_structural_heading{СОДЕРЖАНИЕ}
`,
		files,
	);
	writeTextFile(
		targetDir,
		'03_intro.md',
		String.raw`\sto_structural_heading{ВВЕДЕНИЕ}

Актуальность темы определяется практической потребностью в ... .

Цель работы – ... . Для достижения цели необходимо решить следующие задачи:

${TEX_BEGIN}{sto_enum}
1. изучить предметную область;
2. подготовить данные и методику;
3. провести анализ и сформулировать выводы.
${TEX_END}{sto_enum}

Объект исследования – ... . Предмет исследования – ... .

Методическая основа работы включает ... [@example2026].
`,
		files,
	);
	writeTextFile(
		targetDir,
		'10_methodology.md',
		String.raw`# Методика исследования

Методика исследования строится на ... .

Базовая расчетная зависимость задается формулой @eq:base_metric:

$$y_i = \frac{x_i}{z_i} (@eq:base_metric)$$

где $y_i$ – расчетный показатель, $x_i$ – числитель, $z_i$ – знаменатель.
`,
		files,
	);
	writeTextFile(
		targetDir,
		'20_data.md',
		String.raw`# Данные

Основные характеристики исходных данных приведены в таблице 1.

Таблица 1 – Структура исходных данных (@tab:data_structure)
| Показатель | Значение |
|---|---:|
| Число наблюдений | 0 |
| Число признаков | 0 |

Перед добавлением рисунка положите PNG/JPEG в каталог images и сошлитесь на него до подписи.
`,
		files,
	);
	writeTextFile(
		targetDir,
		'30_results.md',
		String.raw`# Результаты

Результаты анализа показывают ... .
`,
		files,
	);
	writeTextFile(
		targetDir,
		'90_conclusion.md',
		String.raw`\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

В ходе работы были получены следующие результаты:

${TEX_BEGIN}{sto_list}
- выполнен обзор предметной области;
- подготовлена методика исследования;
- сформулированы выводы и ограничения.
${TEX_END}{sto_list}
`,
		files,
	);
	writeTextFile(
		targetDir,
		'91_sources.md',
		String.raw`\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}

${TEX_BEGIN}{sto_bibliography}
${TEX_END}{sto_bibliography}
`,
		files,
	);
	writeTextFile(
		targetDir,
		'references.bib',
		String.raw`@article{example2026,
  author = {Иванов, И. И.},
  title = {Пример источника для шаблона отчета},
  journal = {Вестник примеров},
  year = {2026},
  number = {1},
  pages = {1--10}
}
`,
		files,
	);
	writeTextFile(targetDir, 'images/.gitkeep', '', files);

	const gitInitialized =
		options.initGit === false ? false : initLocalGit(targetDir);
	return { targetDir, files, gitInitialized };
}
