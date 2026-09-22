---
id: 14
title: Устранить high advisories production dependencies
status: done
priority: critical
created: 2026-09-02T08:11:34.269749432+04:00
updated: 2026-09-21T19:26:30.100739312+04:00
started: 2026-09-02T08:11:34.288061851+04:00
completed: 2026-09-21T19:26:23.004384559+04:00
tags:
    - security
    - dependencies
class: standard
---

Разобрать adm-zip, image-size и транзитивные form-data/js-yaml/nanoid; обновить или ограничить поверхность безопасно, добавить CI gate и regression tests для недоверенных DOCX/изображений.

[[2026-09-21]] Mon 19:26
Устранено в 36ec294: обновлены adm-zip/image-size/docx/jsdom/tsx и транзитивные зависимости; npm ci и npm audit --audit-level=low дают 0 vulnerabilities; security:audit включен в ci:check; полный quality и DOCX regression tests прошли.
