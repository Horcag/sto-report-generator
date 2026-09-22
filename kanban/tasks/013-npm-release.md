---
id: 13
title: Герметичный npm release без локальных файлов
status: done
priority: critical
created: 2026-09-02T08:11:34.249437057+04:00
updated: 2026-09-02T09:00:10.548370139+04:00
started: 2026-09-02T08:11:34.287447066+04:00
completed: 2026-09-02T09:00:10.548819881+04:00
tags:
    - packaging
    - security
    - ci
claimed_by: atlas-lime
claimed_at: 2026-09-02T09:00:10.548370139+04:00
class: standard
---

Зафиксировать allowlist содержимого npm-артефакта; исключить .omx, kanban runtime, agent skills, tests/private fixtures и локальное состояние. Release должен проверять npm pack --dry-run.
