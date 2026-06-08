# DOTM Template Style Audit

Источник: `tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm`.

Шаблон разобран как OpenXML ZIP: основные параметры взяты из `word/styles.xml` и `word/numbering.xml`. Макросы `.dotm`
не используются генератором.

## Перенесено в генератор

- `+Абзац с отступом 1-ой строки`: Times New Roman 14 pt, line `360`, firstLine `709`, alignment `both`.
- `+№ - Название рисунка`: center, line `240`, before `120`, after `240`, firstLine `0`.
- `+№ - Название таблицы`: left, line `240`, before `120`, after `120`, firstLine `0`, `keepNext`.
- `+Оглавление 1..4`: right tab stop `9356` with dot leader; indents `0`, `284`, `567`, `851`.
- Heading styles: numbered headings keep with next paragraph; level 1 starts from a new page.

## Уже совпадало

- Main text: 14 pt, 1.5 line spacing, first-line indent 1.25 cm.
- Structural centered uppercase headings with page break before.
- Title page text: 12 pt and centered base style.
- Table text: left alignment, single spacing, firstLine `0`.
- Bibliography/list numbering uses firstLine `709` instead of hanging indent.

## Не переносить автоматически

- `MTDisplayEquation` tab-stop style: текущий генератор центрирует формулы и ставит номер справа через table layout. Менять
  это стоит отдельным экспериментом, потому что затрагивается нумерация формул и DOCX validation.
- Appendix heading styles from DOTM: сначала нужна автоматическая нумерация объектов приложений `А.1` в parser/reference
  registry.
- Macro/template-only styles: они не дают переносимой проверки и не должны попадать в shared config.

## Вывод

DOTM полезен как эталон численных параметров стилей, но не как готовая зависимость. Переносить нужно только stable
OpenXML-параметры, которые генератор может воспроизвести без Word UI и макросов.
