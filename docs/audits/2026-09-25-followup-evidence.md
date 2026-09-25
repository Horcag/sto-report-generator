# STO follow-up evidence (2026-09-25)

The source audit remains a requirement inventory. A `partial` row means that the
named behavior has a model and a focused check, while another acceptance boundary
remains open. It is not a certificate for all report types.

## Real report checks

The private `reports/` tree was read through a temporary link in this worktree.
Its files were not edited or included in the branch. The source preflight passed
for `report_sem6` and `coursework_sad` with editorial referat warnings. Both
reports were built from Markdown and passed 46/46 generated DOCX XML checks.
The earlier build failure on the cited `@norm` entries was fixed by rendering
their supplied author and document designation; the real NIR and coursework
builds then completed.

The NIR passed native Word acceptance and reopened at 25 pages. The coursework
Word acceptance failed while opening its staged input. Its cleanup guard refused
to close Word PID 93028 because the process had unexpected windows; this is a
live process boundary, not a passing acceptance result. The Igor document is a
finished external DOCX validator fixture. No corresponding Markdown project was
found, so it cannot serve as a generator backtest.

## Figure and table stress case

The original accepted `tsp_lab0` PDF had Figure 1 on page 5 and its caption on
page 6. A fresh build from a temporary copy of the report modules passed native
Word acceptance at 9 pages. In its PDF, Figure 1 and the caption are together on
page 6. Table text on pages 6–7 keeps `users.password_hash`, `VARCHAR(254)`, and
`route_places.position` intact. This verifies the new image `keepNext` and table
width allocation in this report with the current Word and printer settings.

The earlier PDF split Table 1 across pages 6–7 and repeated its header without
the `Продолжение таблицы 1` label required by STO §6.2.12. The Word acceptance
path now tries moving a captioned table to the next page and retains the move
only when the whole table fits; otherwise it rejects the unlabeled split and
calls for authored continuation parts. Portable PowerShell and launcher tests
pass. A fresh native Word acceptance of this path passed at 9 pages: Figure 1
and its caption remain on page 6, and the complete Table 1 with its caption is
on page 7. The Word process was absent after the run. The fail-closed path for a
table too long to fit one page remains covered by the PowerShell test rather
than a native long-table sample.

## Conditional forms and visual comparison

The NIR plan, supervisor review, and statement are separate conditional forms.
They are not inserted into the general report. The bachelor and master VKR
profiles have distinct title paths and generator tests. Exact official title
geometry, especially the master form, still needs a matched reference.

The visual comparison harness checks matching content and render context before
pixel comparison. No controlled golden PDF pair exists yet. Its unit tests do
not close `SUP-V07`.
