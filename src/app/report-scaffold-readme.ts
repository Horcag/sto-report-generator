import { ReportProfile } from '@/shared/lib/report-config';

export function reportReadmeTemplate(
	slug: string,
	reportPath: string,
	profile: ReportProfile,
): string {
	const profileLabel = {
		nir: 'НИР',
		coursework: 'курсовой работы',
		lab: 'лабораторной работы',
		'vkr-bachelor': 'ВКР бакалавра',
		'vkr-master': 'ВКР магистра',
	}[profile];
	return String.raw`# ${slug}

Локальная папка ${profileLabel} создана генератором STO Report Generator.

## Быстрый цикл

Команды запускаются из корня генератора:

    npm run check:source -- ${reportPath}
    npm run generate:report -- ${reportPath} --renderer portable --validate
    npm run generate:report -- ${reportPath} --renderer word --validate

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

export function reportGitignoreTemplate(): string {
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
