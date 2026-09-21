# STO Report Generator

STO Report Generator собирает русскоязычные академические отчеты `.docx` из модульных Markdown-файлов. Базовый продукт -
переносимая сборка DOCX и структурная проверка OpenXML без Microsoft Word. Это удобно для WSL, Linux, macOS, Windows,
CI и агентных сценариев.

Word-путь остается отдельным режимом: он нужен, когда требуется авторитетная пагинация, обновление полей Word и экспорт
PDF через установленный Microsoft Word в Windows.

![Первая страница демонстрационного примера](docs/assets/example-page-1.png)

![Пятая страница демонстрационного примера](docs/assets/example-page-5.png)

## Быстрый старт

```bash
npm install
uv sync
npm run hooks:install
npm run new:report -- my_report --profile coursework --dir reports/my_report --title "Название темы"
npm run check:source -- reports/my_report
npm run generate:report -- reports/my_report --renderer portable --validate
```

Для комплексной проверки без Word:

```bash
npm run audit:report -- reports/my_report --renderer portable
```

Для финальной Word/PDF-проверки в Windows с установленным Microsoft Word:

```powershell
npm run audit:report -- reports/my_report --renderer word
```

Если DOCX уже собран в WSL и нужен только финальный пропуск через Microsoft Word на Windows-хосте:

```bash
npm run accept:word -- reports/my_report/build/my_report.docx
```

Команда `accept-word` вызывает Windows PowerShell и Word COM напрямую. Она не требует Windows Python и `pywin32`, не
запускает LibreOffice и по умолчанию сохраняет отдельные файлы
`*.accepted.docx`, `*.accepted.pdf`, `*.acceptance.json` рядом с исходным DOCX.

## Что поддерживается

| Возможность                                                   | Переносимый режим | Word-режим | `accept-word` |
| ------------------------------------------------------------- | ----------------- | ---------- | ------------- |
| Создание структуры отчета                                     | Да                | Да         | Нет           |
| Preflight исходных Markdown-файлов                            | Да                | Да         | Нет           |
| Сборка `.docx` из Markdown, формул, таблиц, рисунков и BibTeX | Да                | Да         | Нет           |
| Проверка структуры DOCX через OpenXML                         | Да                | Да         | Нет           |
| Родные имена стилей из DOTM Самарского университета           | По умолчанию      | Да         | Проверяет     |
| Обновление полей Word и оглавления                            | Нет               | Да         | Да            |
| Авторитетная пагинация и PDF                                  | Нет               | Да         | Да            |

Переносимый режим означает кроссплатформенную OOXML-сборку и структурную проверку. Это не авторитетная пагинация.
Доказательство готовности к сдаче - принятые `*.accepted.docx` и `*.accepted.pdf`, созданные целевым Microsoft Word, плюс
JSON-манифест `*.acceptance.json` с версией Word, числом страниц, хешами файлов, проверкой Times New Roman и проверкой
ожидаемых стилей. LibreOffice не является поддерживаемым финальным renderer.

LibreOffice и Microsoft Graph пока остаются backlog: для них здесь не доказан desktop-identical контракт с Word. Electron
не входит в текущую границу продукта; основной интерфейс - CLI и агентные сценарии.

## Структура отчета

Обычный отчет хранится как набор отсортированных модулей:

```text
reports/my_report/
  00_metadata.md
  01_referat.md
  02_toc.md
  03_intro.md
  10_main.md
  90_conclusion.md
  91_sources.md
  references.bib
  images/
  report.config.json
```

`00_metadata.md` содержит данные титульного листа:

```markdown
---
department: 'Институт информатики и кибернетики'
subdepartment: 'Кафедра технической кибернетики'
reportType: 'Отчет по курсовой работе'
degree: 'по дисциплине "Название дисциплины"'
semester: 6
specialtyCode: '01.03.02'
specialtyName: 'Прикладная математика и информатика'
profileName: 'Искусственный интеллект и компьютерные науки'
studentName: 'Иванов Иван Иванович'
groupNumber: '6300 - 010302D'
topic: 'Название темы'
supervisorName: 'Петров Петр Петрович'
supervisorTitle: 'кандидат технических наук, доцент'
city: 'Самара'
year: 2026
bibliography: 'references.bib'
---
```

Пример содержательного модуля:

```text
\sto_structural_heading{ВВЕДЕНИЕ}

Цель работы - проверить сборку отчета по требованиям СТО.

Задачи работы:

\begin{sto_enum}
1. подготовить исходные Markdown-файлы;
2. выполнить preflight-проверки;
3. собрать DOCX и проверить стили.
\end{sto_enum}

Основные характеристики приведены в таблице 1.

Таблица 1 - Основные характеристики примера (@tab:example)
| Показатель | Значение |
|---|---:|
| Число разделов | 3 |

Иллюстрация показана на рисунке 1.

![Демонстрационный рисунок](images/example.png)

Рисунок 1 - Демонстрационный рисунок (@fig:example)
```

Макросы `sto_enum`, `sto_list` и `sto_bibliography` предназначены для исходников отчета. В документации они приводятся
только внутри fenced-примеров.

## Конфигурация

Основной пример настроен под переносимый режим:

```json
{
	"profile": "coursework",
	"renderer": "portable",
	"sourceDir": ".",
	"outputDocx": "build/my_report.docx",
	"document": {
		"requiredStructuralHeadings": [
			"РЕФЕРАТ",
			"СОДЕРЖАНИЕ",
			"ВВЕДЕНИЕ",
			"ЗАКЛЮЧЕНИЕ"
		],
		"optionalStructuralHeadings": [
			"ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ",
			"СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ"
		],
		"requireReferat": true,
		"requireSources": "when-cited"
	},
	"preflight": {
		"strict": false,
		"softTextRules": "warning"
	},
	"postBuild": {
		"enabled": false,
		"exportPdf": false
	},
	"validate": {
		"enabled": true,
		"unpackDir": ".temp_docx"
	}
}
```

Word/PDF включается явно:

```json
{
	"renderer": "word",
	"postBuild": {
		"enabled": true,
		"exportPdf": true
	}
}
```

Финальная приемка уже созданного DOCX через Word:

```bash
npm run accept:word -- reports/my_report/build/my_report.docx \
  --accepted-docx reports/my_report/build/my_report.accepted.docx \
  --pdf reports/my_report/build/my_report.accepted.pdf \
  --manifest reports/my_report/build/my_report.acceptance.json
```

На WSL команда использует `powershell.exe` Windows-хоста и конвертирует пути через `wslpath`. На native Windows она
использует установленный Microsoft Word напрямую. На macOS и обычном Linux без Windows-хоста команда завершается рано с
инструкцией запустить приемку на WSL/Windows. Для `samara-template-2022` список ожидаемых отображаемых имен стилей
берется из TypeScript-конфигурации генератора и передается в PowerShell через UTF-8 JSON.

Microsoft Office должен быть активирован для того же Windows-пользователя, который запускает команду или self-hosted
runner. Перед запуском Word проверяется лицензия поддерживаемого Microsoft 365 Apps или Office-продукта с Word:
vNext/device через `vnextdiag.ps1`, legacy/volume через `OSPP.VBS`; режимы `NOTIFICATIONS` и истекший
grace period завершают приемку сразу с понятной ошибкой, а не оставляют PDF-экспорт зависшим.

`accept-word` не заменяет `--renderer word`: он не выполняет Python/pywin32 post-build, не чинит формулы и не делает
format-repair из `scripts/sto_post_build/`. Это только финальная приемка уже сгенерированного DOCX в Microsoft Word.

Пути в `report.config.json` должны быть относительными к папке отчета. Локальные абсолютные пути, личные каталоги,
закрытые ссылки и идентификаторы пользователей не должны попадать в README, инвентарь источников или публичные fixtures.

## Стили Самарского шаблона

Генератор по умолчанию использует отображаемые имена из эталонного DOTM
`SHablon_oformlenija_VKR_2022_5_6.dotm`. Внутренние style ID (`Normal`, `StoHeading1`, `FigureCaption`, `TableText` и
другие) остаются стабильными, а в Word видны родные имена шаблона: `+Абзац с отступом 1-ой строки`,
`+ЗАГОЛОВОК по центру`, `+ЗаголРеферСодерж`, `+Заголовок 1 уровня`, `+№ - Название рисунка`,
`+№ - Название таблицы`, `+Текст в таблице`, `+Тит_Абзац по центру` и `+Оглавление 1..4`.

Для уровней 5–6 используются реальные имена DOTM `heading 5` и `heading 6`: пользовательских стилей
`+Заголовок 5 уровня` и `+Заголовок 6 уровня` в эталонном шаблоне нет.

Старые нейтральные отображаемые имена доступны только как явный режим совместимости:

```json
{
	"stylePreset": "default"
}
```

Переключатель меняет только отображаемые имена сопоставленных стилей. Тесты проверяют, что style ID и XML
форматирования не меняются.

## Проверки

```bash
npm run doctor
npm run check:source -- example
npm run audit:report -- example --renderer portable
npm run accept:word -- example/build/example.docx
npm run check:pack
npm run security:audit
npm run quality
```

`npm run doctor` показывает доступность переносимого режима, legacy Word-режима и Word acceptance для текущей платформы.
Он не должен печатать личные пути.

## Preview

Изображения в `docs/assets/example-page-1.png` и `docs/assets/example-page-5.png` сгенерированы из демонстрационного отчета
`example/`. Они содержат только демонстрационные имена и placeholder-содержание.

Воспроизводимый renderer-agnostic сценарий:

```bash
npm run audit:report -- example --renderer portable
```

После этого можно открыть полученный DOCX в выбранном локальном просмотрщике и экспортировать нужные страницы в PNG. Для
публичной документации используйте только демонстрационный отчет `example/`, а не страницы частных работ.

## Частые проблемы

| Симптом                                  | Что проверить                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit` пропускает post-build            | Проверьте `--renderer`: portable сознательно не запускает Word.                                                                                                                                 |
| Нужен PDF с точной пагинацией            | Для полной post-build обработки запустите `npm run audit:report -- reports/<slug> --renderer word` в Windows; для уже собранного DOCX запустите `npm run accept:word -- <docx>` из WSL/Windows. |
| Preflight отклоняет список               | Используйте `sto_list` или `sto_enum` в исходниках отчета.                                                                                                                                      |
| Preflight отклоняет `\begin{...}`        | Проверьте список окружений в `src/shared/config/sto-rules.json`.                                                                                                                                |
| Не найден рисунок                        | Укажите путь относительно папки отчета, например `images/chart.png`.                                                                                                                            |
| Цитата осталась как `[@key]`             | Добавьте запись в `references.bib` и проверьте поле `bibliography`.                                                                                                                             |
| Нужны старые нейтральные названия стилей | Укажите `stylePreset: "default"`; штатный режим уже использует имена из DOTM.                                                                                                                   |

## Документация

- `docs/report-authoring.md` - правила написания Markdown-отчетов.
- `docs/sto-rules-coverage.md` - покрытие правил СТО проверками.
- `docs/architecture/dotm-template-style-audit.md` - безопасно извлеченные параметры DOTM fixture.
- `docs/architecture/python-post-build.md` - архитектура Word post-build.
- `docs/source-inventory.md` - публичная инвентаризация источников и preview provenance.
- `tests/README.md` - структура тестов.
