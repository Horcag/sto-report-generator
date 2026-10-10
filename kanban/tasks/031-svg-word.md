---
id: 31
title: Проверять совместимость базовых линий SVG с Word
status: done
priority: high
created: 2026-10-10T14:24:57.039720605+04:00
updated: 2026-10-10T14:51:28.150059722+04:00
completed: 2026-10-10T00:00:00Z
tags:
    - figures
    - word
    - svg
class: standard
---

SVG figure planning now emits a separate compatibility diagnostic for risky baseline declarations on text, ancestors and CSS. The warning persists in the inspector; strict source preflight and DOCX parsing reject the figure. Source bytes remain unchanged. The guide explains explicit alphabetic coordinates and the limits of declaration scanning.

Delivered in PR https://github.com/Horcag/sto-report-generator/pull/55, merged as e84cd1eb93689c71b81bc8b18d45a4b3aeebc907. Verified feature head: cb2c9edf9133e13cfa526602d0a0ed2b40b2fd23; merged source tree is identical.

Validation: 11 risky and 9 safe/nontext SVG forms; strict parser/preflight, source preservation, independent font size and live inspector tests; 31 TypeScript suites and coverage; 28 Python policy tests; lint/typecheck/package/links/spelling/Python quality; two independent reviews. Push and PR CI passed on Linux, Windows and macOS (runs 38045975202 and 38045976771).

Also fixed four GitHub Python development alerts by locking virtualenv 21.7.13 and its required python-discovery 1.6.2. Frozen Python 3.12 installation, environment creation with spaces and an actual Python pre-commit hook passed. npm audit found zero vulnerabilities. Use synthetic fixtures; private reports were not published.
