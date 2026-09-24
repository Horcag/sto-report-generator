---
id: 8
title: LibreOffice preview backend
status: done
priority: medium
created: 2026-09-02T08:06:41.353644414+04:00
updated: 2026-09-24T20:22:01.381040962+04:00
started: 2026-09-24T20:21:52.920727425+04:00
completed: 2026-09-24T20:21:52.920727425+04:00
tags:
    - renderer
    - libreoffice
class: standard
---

Добавить opt-in PDF preview через LibreOffice на Windows/Linux/macOS, явно маркируя его неавторитетным относительно Word pagination.

[[2026-09-24]] Thu 20:21
24.09.2026: opt-in CLI preview через LibreOffice добавлен как команда preview <docx> [--pdf] [--soffice]. Изолирован профиль LO, задан timeout, проверяется PDF signature; launcher test и typecheck прошли. На этом host LibreOffice не установлен, поэтому живое сравнение PDF не проводилось; результат явно не авторитетен для пагинации Word.
