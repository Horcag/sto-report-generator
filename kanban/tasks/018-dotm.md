---
id: 18
title: Полностью переработать генерацию таблиц по СТО и эталонному DOTM
status: done
priority: critical
created: 2026-09-22T06:38:21.081854955+04:00
updated: 2026-09-22T15:24:18.702694086+04:00
started: 2026-09-22T06:38:30.503082604+04:00
completed: 2026-09-22T00:00:00Z
tags:
    - tables
    - standards
    - docx
    - pr-18
class: standard
---

Контекст: PR #18 формально проходит CI, но визуальная и нормативная корректность таблиц не доказана. Проверить заголовок таблицы, текст ячеек, ширины столбцов, переносы, повтор заголовка, отступы, выравнивание и MTD/formula layout по эталонному DOTM, локальному СТО и учебным материалам. Обязательная приемка: XML-контракт + реальный Word PDF/скриншоты + регрессии.

[[2026-09-22]] Tue 06:49
PR #20 создан поверх PR #18 после сверки с СТО и DOTM. npm test, typecheck, lint, format и diff-check проходят. Word COM acceptance завис и вынесен в #19; MTDisplayEquation вынесен в #20 канбан-доски.

[[2026-09-22]] Tue 06:53
После merge актуального master конфликт PR устранён; повторный полный npm test PASS.

[[2026-09-22]] Tue 15:16
После merge исправления Word acceptance из #22 ветка PR #20 обновлена до master (merge c23b16e). Полный npm test, typecheck, lint и format:check PASS. Реальный Word acceptance PASS: status=accepted, DOCX 8→8 страниц, stablePageCount=true, PDF экспортирован, processCleanupVerified=true. Визуальная проверка PDF подтверждает поля ячеек и content-aware ширины; обычная шапка не жирная по STO/DOTM-контракту.

[[2026-09-22]] Tue 15:21
PR #20 влит в master squash-коммитом d80a6d1 после зелёных GitHub checks (Ubuntu, Windows, macOS, SonarQube) и реальной Word/PDF-приёмки. Дерево merge-коммита побайтно совпадает с проверенным head c23b16e.

[[2026-09-22]] Tue 15:24
Финальный повтор уже из master d80a6d1 проверил recovery path: background-попытка штатно завершена по дедлайну 45 с, точный staging очищен, interactive fallback успешно завершил acceptance. Manifest: accepted; attemptedModes=[background, interactive]; completedMode=interactive; processCleanupVerified=true; 8→8 страниц.
