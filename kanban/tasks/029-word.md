---
id: 29
title: 'Управление рисунками: размеры, обрезка, читаемость и сохранение качества Word'
status: done
priority: high
created: 2026-10-10T10:37:42.536616451+04:00
updated: 2026-10-10T12:48:35.846910118+04:00
started: 2026-10-10T10:38:12.907638771+04:00
completed: 2026-10-10T12:46:45.019734715+04:00
tags:
    - figures
    - word
    - quality
class: standard
---

Persistent figure controls implemented and merged in PR https://github.com/Horcag/sto-report-generator/pull/50 as 49a545fa41eed1aff5e437bc9a0a759824e612d2.

Includes per-occurrence physical dimensions and native crop, DPI and diagram text diagnostics, genuine PNG fallbacks for SVG, a browser inspector using report assets, and image integrity verification after Word save/reopen. Compatible dependency replacements remove the blocking security findings while retaining audit and FSD gates.

Validation on cf7577457b3ef65264f236de5e0639a523a2adef: both push and PR CI green on Linux, Windows and macOS; all 30 TypeScript suites and 28 Python policy tests passed; npm audit reports zero vulnerabilities. The merge tree matches this tested head. Installed Word 16.0.20430 accepted all five figures with original media, dimensions and crop preserved and processCleanupVerified=true. All three final PDF pages were inspected; some raster exports remain around 200 DPI despite high-quality export, while the tested SVG remains vector. This limitation is documented separately from DOCX preservation.

Usage and measured acceptance: docs/figure-controls.md and docs/audits/2026-10-10-figure-controls.md.
