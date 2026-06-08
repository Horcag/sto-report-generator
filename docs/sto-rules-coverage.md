# STO Rules Coverage

Документ фиксирует перенос правил из `extracted STO/methodical materials` в генератор. Он заменяет старый checklist из `reports/docs`: шаблонные требования `.dotm` теперь учитываются здесь вместе с source-preflight, DOCX XML validator и Python post-build.

## Статусы

| Область СТО                                                            | Статус                | Где контролируется                                                                                                 |
| ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Базовая типографика: Times New Roman, 14 pt, черный цвет, интервал 1,5 | Implemented           | `sto-rules.json`, `sto-styles.ts`, `sto-validator.ts`                                                              |
| Поля страницы 30/15/20/20 мм                                           | Implemented           | DOCX validator проверяет все `w:pgMar`, а не только первую секцию                                                  |
| Абзацный отступ 1,25 см и выравнивание основного текста по ширине      | Implemented           | `Normal Paragraph Indent & Alignment` в DOCX validator                                                             |
| Отступы подписей и текста таблиц                                       | Implemented           | `FigureCaption`, `TableCaption`, `TableText` style checks                                                          |
| Структурные заголовки                                                  | Implemented           | `\sto_structural_heading{...}`, profile-aware source preflight, DOCX heading style checks                          |
| Разделы и подразделы                                                   | Implemented           | numbered heading styles, heading casing/page-break validator, Markdown heading preflight                           |
| Реферат                                                                | Partially implemented | плейсхолдеры и keywords проверяются; смысловая полнота остается warning                                            |
| Оглавление                                                             | Implemented           | scaffold/profile structure + Word post-build TOC update                                                            |
| Источники и цитирование                                                | Implemented           | BibTeX keys, used-only bibliography, dense citation numbers, no manual `[1]`, required fields for cited entries    |
| Электронные источники                                                  | Implemented           | cited URL entries require supported protocol and `urldate` in `YYYY-MM-DD` as warnings                             |
| Формулы                                                                | Implemented           | labels, unparsed math, decimal comma, forbidden `*`/`·`, forbidden `:` division, punctuation before `где`          |
| Формулы подряд и переносы                                              | Partially implemented | warnings for consecutive formulas, raw `...`, bare function names and unsafe source line breaks                    |
| Таблицы                                                                | Implemented           | caption format, empty cells, header periods, repeated headers, caption adjacency                                   |
| Границы таблиц                                                         | Partially implemented | diagonal borders are blocked; full visual border sufficiency is still manual/review                                |
| Рисунки                                                                | Implemented           | reference-before-caption preflight, image existence, width/centering, caption adjacency                            |
| Приложения                                                             | Partially implemented | order after sources, reference-before-appendix, labels/order/duplicates, object-numbering warnings                 |
| Перечни                                                                | Implemented           | only `sto_list`/`sto_enum`, marker rules, forbidden letters, intro sentence and punctuation warnings               |
| Примечания                                                             | Partially implemented | basic dash/numbering warnings; semantic placement remains manual                                                   |
| Микротипографика текста                                                | Implemented           | em dash, tabs, bare `№`/`%`, comparison signs, decimal dot, straight quotes, negative hyphen, repeated range units |
| Мягкие правила изложения                                               | Partially implemented | suspicious abbreviations, numbers 1-9, `D` as diameter are warnings                                                |
| Конфигурация и профили                                                 | Implemented           | `nir`, `coursework`, `lab`, profile merge, portable path diagnostics                                               |
| Word post-build                                                        | Implemented           | TOC, counters, formula repair, table header repeat, image normalization, dirty fields, PDF export                  |

## Что добавлять дальше

1. Расширить приложения до полноценной нумерации `А.1` в parser/reference registry, а не только warning в preflight.
2. Добавить formatter/tests для `@patent`, `@thesis`, стандартов и электронных частей сайтов.
3. Добавить profile-specific title page validator для лабораторной, курсовой, НИР и ВКР.
4. Добавить проверку неразрывного пробела между числом и единицей после нормализации DOCX.
5. Проверять большие/landscape таблицы через отдельный opt-in профиль, потому что автоматическая пагинация Word нестабильна без COM.

## Не блокировать жестко

- Числа от 1 до 9 словами: правило полезно как warning, но дает ложные срабатывания в метриках, моделях и обозначениях.
- Смысловые требования к введению, заключению и результатам: лучше отдельный review/AI checklist, не regex.
- Полное начертание математических символов в OMML: можно проверять выборочно, но не как обязательный quality gate.
- Семантическое применение `\times`: методичка разрешает его для размеров, векторного произведения и переносов, но
  автоматическая проверка без понимания смысла даст ложные срабатывания.
- Разговорные обороты и терминологическую чистоту: оставить для редакторского контроля или отдельного словаря проекта.
