# Humanizer-ru в генераторе

В `.agents/skills/humanizer-ru/` находится полный снимок исходного репозитория
[Vladimir-Human/humanizer-ru](https://github.com/Vladimir-Human/humanizer-ru/releases/tag/v3.36.4)
из релиза `v3.36.4` (коммит `fa3296a509ffef1665b3446f55e2e17b52c5a2e4`, 1038 отслеживаемых файлов).
Здесь есть `SKILL.md`, справочники, `knowledge/`, Python CLI и MCP-код, скрипты, тесты,
исследовательские материалы и лицензия. Файлы upstream не редактируются локально.

Агент применяет [SKILL.md](../.agents/skills/humanizer-ru/SKILL.md) при написании и
редактировании русской прозы отчёта по правилам [авторского прохода](report-authoring.md#редакторский-проход-по-русскому-тексту).
Само наличие Python-кода в пакете генератора не устанавливает команды `humanizer-*` в PATH;
для них нужна отдельная установка пакета Humanizer. Сборка DOCX не вызывает эти команды и не
переписывает авторский Markdown автоматически.

Чтобы обновить копию, проверьте [последний выпуск](https://github.com/Vladimir-Human/humanizer-ru/releases),
возьмите его неизменяемый тег и перенесите **всё отслеживаемое дерево** через `git archive`.
Сверьте список файлов и SHA-256 каждого файла с тегом перед заменой текущей папки; обновите здесь
тег, SHA и число файлов. Затем запустите `npm run check:pack`, `npm run test:scaffold`,
`npm run check:markdown-links` и `npm run quality`. Не редактируйте `SKILL.md` ради локальной
политики: правила применения в этом проекте живут в корневом `AGENTS.md` и
`.agents/skills/sto-report-generator/SKILL.md`.

`npm pack` включает всё дерево, кроме служебного `.gitignore`, который npm исключает сам.
