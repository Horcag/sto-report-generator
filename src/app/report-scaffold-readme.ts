import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ReportProfile } from '@/shared/lib/report-config';

function installedPackageRoot(
	cwd: string,
	packageRoot: string,
): string | undefined {
	for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
		const candidate = path.join(
			current,
			'node_modules',
			'sto-report-generator',
		);
		if (
			fs.existsSync(candidate) &&
			fs.realpathSync(candidate) === fs.realpathSync(packageRoot)
		) {
			return candidate;
		}
		if (path.dirname(current) === current) return undefined;
	}
}

export function reportReadmeLinkTarget(value: string): string {
	if (/^(?:[a-z]:\/|\/\/)/i.test(value)) {
		return pathToFileURL(value, { windows: true }).href;
	}
	return value.split('/').map(encodeURIComponent).join('/');
}

export function reportReadmeTemplate(
	slug: string,
	targetDir: string,
	profile: ReportProfile,
	cwd: string,
): string {
	const packageRoot = path.resolve(__dirname, '../..');
	const installedRoot = installedPackageRoot(cwd, packageRoot);
	const runnerDir = installedRoot ? path.resolve(cwd) : packageRoot;
	const relativePath = (from: string, to: string): string =>
		path.relative(from, to).split(path.sep).join('/') || '.';
	const reportPath = relativePath(runnerDir, targetDir);
	const runnerPath = relativePath(targetDir, runnerDir);
	const resourceLink = (label: string, resource: string): string =>
		`[${label}](<${reportReadmeLinkTarget(relativePath(targetDir, path.join(installedRoot ?? packageRoot, resource)))}>)`;
	const skill = resourceLink(
		'навык STO Report Generator',
		'.agents/skills/sto-report-generator/SKILL.md',
	);
	const prose = resourceLink(
		'протокол научного текста',
		'.agents/skills/sto-report-generator/references/scientific-prose.md',
	);
	const humanizer = resourceLink(
		'humanizer-ru',
		'.agents/skills/humanizer-ru/SKILL.md',
	);
	const authoring = resourceLink(
		'руководство автора',
		'docs/report-authoring.md',
	);
	const cases = resourceLink(
		'каталог исследований и примеров',
		'docs/case-studies/README.md',
	);
	const check = installedRoot
		? 'npx sto-report-generator check'
		: 'npm run check:source --';
	const generate = installedRoot
		? 'npx sto-report-generator generate'
		: 'npm run generate:report --';
	const commandBlock = (powershell: boolean): string => {
		const quote = (value: string): string =>
			`'${value.replaceAll("'", powershell ? "''" : "'\"'\"'")}'`;
		return `    ${powershell ? 'Set-Location -LiteralPath' : 'cd --'} ${quote(runnerPath)}

    ${check} ${quote(reportPath)}
    ${generate} ${quote(reportPath)} --renderer portable --validate

При установленном Microsoft Word для итогового оформления:

    ${generate} ${quote(reportPath)} --renderer word --validate`;
	};
	const commands = [runnerPath, reportPath].some(value => value.includes("'"))
		? `Bash/zsh:\n\n${commandBlock(false)}\n\nPowerShell:\n\n${commandBlock(true)}`
		: `Bash/zsh и PowerShell (переход cd выполняйте из папки отчёта):\n\n${commandBlock(false).replace('cd -- ', 'cd ')}`;
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

Для нового научного текста или сравнения редакций сначала откройте ${skill} и ${prose}.
Для сопоставимых примеров и результатов используйте ${cases}.
Цикл: факты и степень доказанности → авторские наблюдения → самостоятельные редакции → смысловая сверка → принятый Markdown.
Черновики и журнал сравнений держите вне этой папки входных модулей.

Перед командами выполните редакторский проход по связному русскому тексту исходных Markdown-файлов. Если текст пишет
или редактирует агент, он должен применить навык ${humanizer} из комплекта
STO Report Generator. Уберите явные артефакты копирования и неуместные шаблонные фразы, сохраняя научные термины,
факты, ссылки и формулы. Если вы пишете без агента, используйте ${authoring}. Сам генератор текст не переписывает и не проверяет факт выполнения этого шага.

${installedRoot ? 'Команды запускаются из проекта, в котором установлен пакет.' : 'Команды запускаются из checkout генератора с установленными зависимостями.'}
Если терминал открыт в этой папке отчёта, сначала перейдите в рабочий каталог:

${commands}

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
