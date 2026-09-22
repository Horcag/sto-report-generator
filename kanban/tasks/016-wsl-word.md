---
id: 16
title: 'WSL → установленный Word: обязательная финальная приемка'
status: done
priority: critical
created: 2026-09-02T14:50:28.696610299+04:00
updated: 2026-09-02T15:16:19.323698745+04:00
started: 2026-09-02T15:13:50.79602745+04:00
completed: 2026-09-02T15:16:19.324202504+04:00
tags:
    - wsl
    - word
    - acceptance
claimed_by: mold-edge
claimed_at: 2026-09-02T15:16:19.323698745+04:00
class: standard
---

Добавить поддерживаемый путь из WSL в Microsoft Word for Windows без LibreOffice и без Windows Python: открыть сгенерированный DOCX через Word COM, обновить поля/оглавление, сохранить финальный DOCX, экспортировать PDF и записать manifest с версией Word, числом страниц и результатами проверок. Portable означает только переносимую генерацию OOXML; submission-ready результат подтверждается Word acceptance на целевой машине.

[[2026-09-02]] Wed 15:16
Реализован accept-word из WSL через установленный Windows Word COM. Live manifest: Word 16.0 build 16.0.20326, 8→8 страниц, Times New Roman установлен, 17/17 стилей найдены. Commit: 6d4575db76bb9706dd3e2580e5f40ad16d5e5950.
