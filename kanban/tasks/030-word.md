---
id: 30
title: Исправить итоговую статистику страниц и диагностику очистки Word
status: done
priority: high
created: 2026-10-10T13:25:46.159874305+04:00
updated: 2026-10-10T14:07:24.186247773+04:00
started: 2026-10-10T14:07:24.134112956+04:00
completed: 2026-10-10T14:07:24.134112956+04:00
tags:
    - word
    - acceptance
    - regression
class: standard
---

Final Word acceptance fixes merged in PR https://github.com/Horcag/sto-report-generator/pull/53 as 75c4985b10bd4f78d44d126ee89a20434400db3e.

Managed referat page statistics are now finalized after long-table splitting and checked after save/reopen. Numeric ownership is reported explicitly; already materialized or word-only counts remain unverified. Failed integrity manifests record successful exact-PID cleanup, and failed cleanup never claims verification.

Verified head ef7eb58281efb7d548f7250ea184ca3a4f8d5375 passed both push and PR CI on Linux, Windows and macOS with all 30 TypeScript suites, 28 Python policy cases and security gates. Eight PowerShell statistics cases, exact numeric-token checks, nine mocked launcher cases and 39 figure-integrity cases passed. The merge tree matches the verified head.

Installed Word 16.0.20430 accepted a synthetic 64-row table report with two continuation segments: referat, reopened DOCX, PDF and manifest all report five pages with pageTextVerified=true and verified cleanup. A real oversized SVG-preview reduction was rejected at contentIntegrity with processCleanupVerified=true and zero request directories remaining. Native fixtures are committed; usage and ownership limits are documented in docs/report-authoring.md.
