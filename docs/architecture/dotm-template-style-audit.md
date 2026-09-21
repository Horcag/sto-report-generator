# DOTM Template Style Audit

Источник: `tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm`.

Шаблон разобран как OpenXML ZIP: основные параметры взяты из `word/styles.xml` и `word/numbering.xml`. Макросы `.dotm`
не используются генератором.

## Проверяемый контракт источника

`tests/fixtures/validator/etalon/dotm-style-contract.json` закрепляет SHA-256 canonical fixture
`a8a06c6e9c273149b0ba8629e2552b4fce563916921391dcb51027dc8175b261`. Переносимый тест извлекает `word/styles.xml`,
проверяет полный список из 79 стилей, их ID/type/display name и семантический SHA-256 после исключения изменяемых
служебных revision-метаданных. Имя, тип и ID включены в семантический hash. Каждый стиль классифицирован ровно один раз: `mapped`, `adapted`, `deferred` или
`ignored`.

Acquisition artifact из LMS не хранится в репозитории: его имя, package SHA-256 и полученный при отдельном аудите
semantic SHA-256 закреплены как внешнее evidence. CI повторно доказывает свойства canonical fixture, но не выдаёт
сверку двух значений из manifest за live-проверку внешнего файла.

`mapped` означает совпадение display name с конкретным generator style. `adapted` означает перенос поведения через
другую переносимую реализацию; `deferred` оставлен для явной отдельной работы. Поэтому контракт не означает полную
визуальную или Word-pagination parity всех 79 стилей.

## Перенесено в генератор

- Точные отображаемые имена сопоставленных стилей включены по умолчанию. Для пользовательских заголовков DOTM
  содержит `+Заголовок 1 уровня` ... `+Заголовок 4 уровня`; уровни 5–6 в шаблоне называются `heading 5` и `heading 6`.
- Общий структурный заголовок называется `+ЗАГОЛОВОК по центру`, а исключенные из оглавления `РЕФЕРАТ` и
  `СОДЕРЖАНИЕ` используют `+ЗаголРеферСодерж`.
- `+Абзац с отступом 1-ой строки`: Times New Roman 14 pt, line `360`, firstLine `709`, alignment `both`.
- `+№ - Название рисунка`: center, line `240`, before `120`, after `240`, firstLine `0`, `keepLines`.
- `+№ - Название таблицы`: left, line `240`, before `120`, after `120`, firstLine `0`, `keepNext`, `keepLines`.
- `+Оглавление 1..4`: right tab stop `9356` with dot leader; indents `0`, `284`, `567`, `851`.
- Numbered headings 1–4: firstLine `709`, line `360`, `keepNext`, `keepLines`; level 1 has after `120` and starts from
  a new page. Numbering is attached to the style, not only to generated paragraphs.
- `+ЗАГОЛОВОК по центру`: before `0`, after `120`, line `360`, page break before, without `keepNext`.
- `+ЗаголРеферСодерж`: effective before `0`, after `240`, line `240`, page break before, without `keepNext`.

## Уже совпадало

- Main text: 14 pt, 1.5 line spacing, first-line indent 1.25 cm.
- Structural centered uppercase headings with page break before.
- Title-page base style: 14 pt, centered, single-line. Individual title-page runs may deliberately override size to reproduce
  the filled sample layout.
- Table text: left alignment, single spacing, firstLine `0`.
- Bibliography/list numbering uses firstLine `709` instead of hanging indent.

## Не переносить автоматически

- `MTDisplayEquation` tab-stop style: текущий генератор центрирует формулы и ставит номер справа через table layout. Менять
  это стоит отдельным экспериментом, потому что затрагивается нумерация формул и DOCX validation.
- Appendix heading styles from DOTM: сначала нужна автоматическая нумерация объектов приложений `А.1` в parser/reference
  registry.
- Built-in `heading 5` and `heading 6`: их display names сохранены, но цветные/курсивные built-in свойства Word не
  копируются, потому что генератор продолжает переносимую черную полужирную иерархию заголовков.
- Macro/template-only styles: они не дают переносимой проверки и не должны попадать в shared config.

## Вывод

DOTM полезен как эталон численных параметров стилей, но не как готовая зависимость. Переносить нужно только stable
OpenXML-параметры, которые генератор может воспроизвести без Word UI и макросов.
