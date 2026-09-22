---
id: 2
title: Кроссплатформенный pipeline и контракт renderer
status: done
priority: critical
created: 2026-09-02T08:06:41.265756256+04:00
updated: 2026-09-02T09:00:10.544441112+04:00
started: 2026-09-02T08:06:47.932177678+04:00
completed: 2026-09-02T09:00:10.544882762+04:00
tags:
    - portability
    - architecture
claimed_by: atlas-lime
claimed_at: 2026-09-02T09:00:10.544441112+04:00
class: standard
---

Разделить portable DOCX build/validate и опциональные renderer-backends. Windows, Linux и macOS должны иметь одинаковый CLI-контракт; exact PDF требует общего renderer.
