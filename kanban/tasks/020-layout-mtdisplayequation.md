---
id: 20
title: Исследовать замену формульной layout-таблицы на стиль MTDisplayEquation
status: done
priority: high
created: 2026-09-22T06:46:52.138030467+04:00
updated: 2026-09-24T20:43:56.722858217+04:00
started: 2026-09-24T20:43:56.727777655+04:00
completed: 2026-09-24T20:43:56.727777655+04:00
tags:
    - formulas
    - dotm
    - technical-debt
    - sto-audit-2026-09
class: standard
---

DOTM содержит MTDisplayEquation с tab stops; генератор пока использует таблицу для центрирования формулы и номера справа. Нужен отдельный эксперимент с проверкой пагинации, номера формул, валидатора и Word acceptance.

Аудит: docs/audits/2026-09-22-sto-coverage/dotm-numeric-deltas.csv и special-atoms.csv, F*. Смена механизма необязательна: сначала одинаковое содержимое в DOTM/генераторе, номер справа на той же строке, многострочные формулы и переносы, измерения Word/PDF; только затем обоснованный выбор реализации.

Приёмка 2026-09-24: две одинаковые копии DOCX с формульной таблицей и MTDisplayEquation/tab-stop преобразованием прошли Word acceptance (8 стабильных страниц, PDF, cleanup); PDF координаты и визуальный осмотр показали у tab-варианта номер (2) на второй строке в середине формулы, а текущий валидатор запрещает body tabs. Обоснованно сохранена layout-таблица. Подробности: docs/audits/2026-09-22-sto-coverage/formula-layout-comparison.md.
