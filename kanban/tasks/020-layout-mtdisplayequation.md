---
id: 20
title: Исследовать замену формульной layout-таблицы на стиль MTDisplayEquation
status: backlog
priority: high
created: 2026-09-22T06:46:52.138030467+04:00
updated: 2026-09-22T18:08:21.330306906+04:00
tags:
    - formulas
    - dotm
    - technical-debt
    - sto-audit-2026-09
class: standard
---

DOTM содержит MTDisplayEquation с tab stops; генератор пока использует таблицу для центрирования формулы и номера справа. Нужен отдельный эксперимент с проверкой пагинации, номера формул, валидатора и Word acceptance.

Аудит: docs/audits/2026-09-22-sto-coverage/dotm-numeric-deltas.csv и special-atoms.csv, F*. Смена механизма необязательна: сначала одинаковое содержимое в DOTM/генераторе, номер справа на той же строке, многострочные формулы и переносы, измерения Word/PDF; только затем обоснованный выбор реализации.
