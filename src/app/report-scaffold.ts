import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
	getReportProfileDocumentConfig,
	isReportProfile,
	ReportProfile,
} from '@/shared/lib/report-config';

export interface ScaffoldReportOptions {
	slug: string;
	cwd?: string;
	dir?: string;
	reportsRoot?: string;
	profile?: ReportProfile;
	title?: string;
	reportType?: string;
	department?: string;
	subdepartment?: string;
	degree?: string;
	semester?: number;
	specialtyCode?: string;
	specialtyName?: string;
	profileName?: string;
	studentName?: string;
	groupNumber?: string;
	supervisorName?: string;
	supervisorTitle?: string;
	supervisorRole?: string;
	year?: number;
	hideSignatures?: boolean;
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

interface ProfileMetadataDefaults {
	reportType: string;
	degree: string;
	topicPrefix: string;
}

const PROFILE_METADATA_DEFAULTS: Record<
	ReportProfile,
	ProfileMetadataDefaults
> = {
	nir: {
		reportType: 'Отчёт о научно-исследовательской работе',
		degree: 'бакалавра',
		topicPrefix: 'Тема научно-исследовательской работы',
	},
	coursework: {
		reportType: 'Отчёт по курсовой работе',
		degree: 'по дисциплине «Название дисциплины»',
		topicPrefix: 'Тема курсовой работы',
	},
	lab: {
		reportType: 'Отчёт по лабораторной работе',
		degree: 'по дисциплине «Название дисциплины»',
		topicPrefix: 'Тема лабораторной работы',
	},
};

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

function resolveProfile(options: ScaffoldReportOptions): ReportProfile {
	if (options.profile === undefined) {
		return 'nir';
	}
	if (!isReportProfile(options.profile)) {
		throw new Error(
			`Invalid report profile "${String(options.profile)}". Use nir, coursework or lab.`,
		);
	}
	return options.profile;
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
	profile: ReportProfile,
	bibliographyPath?: string,
): string {
	const defaults = PROFILE_METADATA_DEFAULTS[profile];
	const year = options.year ?? new Date().getFullYear();
	const bibliographyLine = bibliographyPath
		? `bibliography: "${bibliographyPath}"\n`
		: '';
	return String.raw`---
department: "${options.department ?? 'Институт информатики и кибернетики'}"
subdepartment: "${options.subdepartment ?? 'Кафедра технической кибернетики'}"
reportType: "${options.reportType ?? defaults.reportType}"
degree: "${options.degree ?? defaults.degree}"
semester: ${options.semester ?? 6}
specialtyCode: "${options.specialtyCode ?? '01.03.02'}"
specialtyName: "${options.specialtyName ?? 'Прикладная математика и информатика'}"
profileName: "${options.profileName ?? 'Искусственный интеллект и компьютерные науки'}"
studentName: "${options.studentName ?? 'Фамилия Имя Отчество'}"
groupNumber: "${options.groupNumber ?? '0000 – 000000D'}"
topicPrefix: "${defaults.topicPrefix}"
topic: "${options.title ?? 'Название темы'}"
supervisorName: "${options.supervisorName ?? 'Фамилия Имя Отчество'}"
supervisorTitle: "${options.supervisorTitle ?? 'ученая степень, должность'}"
${options.supervisorRole ? `supervisorRole: "${options.supervisorRole}"\n` : ''}${options.hideSignatures ? 'hideSignatures: true\n' : ''}city: "Самара"
year: ${year}
${bibliographyLine.trimEnd()}
---
`;
}

function reportReadmeTemplate(
	slug: string,
	reportPath: string,
	profile: ReportProfile,
): string {
	const profileLabel = {
		nir: 'НИР',
		coursework: 'курсовой работы',
		lab: 'лабораторной работы',
	}[profile];
	return String.raw`# ${slug}

Локальная папка ${profileLabel} создана генератором STO Report Generator.

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
- references.bib: BibTeX-источники, если работа использует цитирования.

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

function reportConfigTemplate(slug: string, profile: ReportProfile): string {
	const documentConfig = getReportProfileDocumentConfig(profile);
	return `${JSON.stringify(
		{
			profile,
			sourceDir: '.',
			outputDocx: `build/${slug}.docx`,
			document: documentConfig,
			preflight: {
				strict: false,
				softTextRules: 'warning',
			},
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

function referatTemplate(): string {
	return String.raw`\sto_structural_heading{РЕФЕРАТ}

Отчет содержит {{PAGES}} страниц, {{FIGURES}} рисунков, {{TABLES}} таблиц и {{SOURCES}} использованных источников.

ПРЕДМЕТНАЯ ОБЛАСТЬ, МЕТОДИКА, ДАННЫЕ, РЕЗУЛЬТАТ, ВЫВОДЫ

Цель работы – сформулировать цель исследования.

В работе решены следующие задачи:

${TEX_BEGIN}{sto_list}
- описана предметная область;
- подготовлены данные и методы;
- получены и интерпретированы результаты.
${TEX_END}{sto_list}
`;
}

function tocTemplate(): string {
	return String.raw`\sto_structural_heading{СОДЕРЖАНИЕ}
`;
}

function introTemplate(profile: ReportProfile): string {
	if (profile === 'lab') {
		return String.raw`\sto_structural_heading{ВВЕДЕНИЕ}

Цель лабораторной работы – ... .

Для достижения цели необходимо выполнить следующие действия:

${TEX_BEGIN}{sto_enum}
1. изучить исходные данные и постановку задачи;
2. выполнить расчетную или программную часть;
3. проанализировать полученные результаты.
${TEX_END}{sto_enum}
`;
	}

	return String.raw`\sto_structural_heading{ВВЕДЕНИЕ}

Актуальность темы определяется практической потребностью в ... .

Цель работы – ... . Для достижения цели необходимо решить следующие задачи:

${TEX_BEGIN}{sto_enum}
1. изучить предметную область;
2. подготовить данные и методику;
3. провести анализ и сформулировать выводы.
${TEX_END}{sto_enum}

Объект исследования – ... . Предмет исследования – ... .

Методическая основа работы включает ... [@example2026].
`;
}

function methodologyTemplate(profile: ReportProfile): string {
	if (profile === 'lab') {
		return String.raw`# Ход работы

Порядок выполнения лабораторной работы включает ... .
`;
	}

	return String.raw`# Методика исследования

Методика исследования строится на ... .

Базовая расчетная зависимость задается формулой @eq:base_metric:

$$y_i = \frac{x_i}{z_i} (@eq:base_metric)$$

где $y_i$ – расчетный показатель, $x_i$ – числитель, $z_i$ – знаменатель.
`;
}

function dataTemplate(profile: ReportProfile): string {
	if (profile === 'lab') {
		return String.raw`# Исходные данные

Исходные данные и параметры работы приведены в таблице 1.

Таблица 1 – Исходные данные (@tab:lab_input)
| Показатель | Значение |
|---|---:|
| Вариант | 0 |
| Число наблюдений | 0 |
`;
	}

	return String.raw`# Данные

Основные характеристики исходных данных приведены в таблице 1.

Таблица 1 – Структура исходных данных (@tab:data_structure)
| Показатель | Значение |
|---|---:|
| Число наблюдений | 0 |
| Число признаков | 0 |

Перед добавлением рисунка положите PNG/JPEG в каталог images и сошлитесь на него до подписи.
`;
}

function resultsTemplate(profile: ReportProfile): string {
	return profile === 'lab'
		? String.raw`# Результаты выполнения

Результаты выполнения лабораторной работы показывают ... .
`
		: String.raw`# Результаты

Результаты анализа показывают ... .
`;
}

function conclusionTemplate(profile: ReportProfile): string {
	const intro =
		profile === 'lab'
			? 'В ходе лабораторной работы были получены следующие результаты:'
			: 'В ходе работы были получены следующие результаты:';
	return String.raw`\sto_structural_heading{ЗАКЛЮЧЕНИЕ}

${intro}

${TEX_BEGIN}{sto_list}
- выполнен обзор предметной области;
- подготовлена методика исследования;
- сформулированы выводы и ограничения.
${TEX_END}{sto_list}
`;
}

function sourcesTemplate(): string {
	return String.raw`\sto_structural_heading{СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ}

${TEX_BEGIN}{sto_bibliography}
${TEX_END}{sto_bibliography}
`;
}

function referencesTemplate(): string {
	return String.raw`@article{example2026,
  author = {Иванов, И. И.},
  title = {Пример источника для шаблона отчета},
  journal = {Вестник примеров},
  year = {2026},
  number = {1},
  pages = {1--10}
}
`;
}

export function scaffoldReport(
	options: ScaffoldReportOptions,
): ScaffoldReportResult {
	assertValidSlug(options.slug);
	const profile = resolveProfile(options);

	const cwd = options.cwd ?? process.cwd();
	const targetDir = resolveTargetDir(options);
	ensureDirectoryIsEmpty(targetDir);
	fs.mkdirSync(targetDir, { recursive: true });

	const reportPath = toPosixPath(path.relative(cwd, targetDir)) || '.';
	const includeBibliography = profile !== 'lab';
	const bibliographyPath = includeBibliography
		? toPosixPath(
				path.relative(cwd, path.join(targetDir, 'references.bib')),
			)
		: undefined;
	const files: string[] = [];

	writeTextFile(targetDir, '.gitignore', reportGitignoreTemplate(), files);
	writeTextFile(
		targetDir,
		'README.md',
		reportReadmeTemplate(options.slug, reportPath, profile),
		files,
	);
	writeTextFile(
		targetDir,
		'report.config.json',
		reportConfigTemplate(options.slug, profile),
		files,
	);
	writeTextFile(
		targetDir,
		'00_metadata.md',
		metadataTemplate(options, profile, bibliographyPath),
		files,
	);
	if (profile !== 'lab') {
		writeTextFile(targetDir, '01_referat.md', referatTemplate(), files);
		writeTextFile(targetDir, '02_toc.md', tocTemplate(), files);
	}
	writeTextFile(targetDir, '03_intro.md', introTemplate(profile), files);
	writeTextFile(
		targetDir,
		'10_methodology.md',
		methodologyTemplate(profile),
		files,
	);
	writeTextFile(targetDir, '20_data.md', dataTemplate(profile), files);
	writeTextFile(targetDir, '30_results.md', resultsTemplate(profile), files);
	writeTextFile(
		targetDir,
		'90_conclusion.md',
		conclusionTemplate(profile),
		files,
	);
	if (includeBibliography) {
		writeTextFile(targetDir, '91_sources.md', sourcesTemplate(), files);
		writeTextFile(targetDir, 'references.bib', referencesTemplate(), files);
	}
	writeTextFile(targetDir, 'images/.gitkeep', '', files);

	const gitInitialized =
		options.initGit === false ? false : initLocalGit(targetDir);
	return { targetDir, files, gitInitialized };
}
