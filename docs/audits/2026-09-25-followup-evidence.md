# STO follow-up evidence (2026-09-25)

The source audit remains a requirement inventory. A `partial` row means that the
named behavior has a model and a focused check, while another acceptance boundary
remains open. It is not a certificate for all report types.

## Real report checks

The private `reports/` tree was read through a temporary link in this worktree.
Its files were not edited or included in the branch. The source preflight passed
for `report_sem6` and `coursework_sad` with editorial referat warnings. Both
reports were built from Markdown and passed the original 46/46 generated DOCX XML checks.
The earlier build failure on the cited `@norm` entries was fixed by rendering
their supplied author and document designation; the real NIR and coursework
builds then completed.

The NIR passed native Word acceptance and reopened at 25 pages. The coursework
initially failed while Word opened the staged DOCX. The generated
`word/document.xml` contained 27 literal `<undefined>` elements around math run
properties: importing a single XML property through `ImportedXmlComponent.fromXmlString`
inserted its wrapper instead of the property element. A prefix bisect isolated
the first offending formula. The converter now imports the property element and
its children directly, and the generated-DOCX validator rejects `<undefined>`.
A fresh coursework build had no such elements and passed 47/47 XML checks.

The fresh coursework DOCX passed native Word acceptance. Word opened the input,
split its long Table 4 into three single-page segments with two numbered
continuation captions, saved and reopened the DOCX at 65 pages, and exported the
PDF. The saved DOCX contains both `Продолжение таблицы 4` captions and no
`<undefined>` elements. This acceptance covers the actual coursework build,
including 178 formulas. The source Table 4 had 34 rows; the accepted segments
have 6, 18, and 12 rows, with matching repeated headers and all 34 original
rows preserved in order after removing the repeated headers. The original
failed attempt's cleanup guard had refused
to close Word PID 93028 because of unexpected windows; the successful run ended
without a remaining Word process. The Igor document is a finished external DOCX
validator fixture. No corresponding Markdown project was found, so it cannot
serve as a generator backtest.

## Figure and table stress case

The original accepted `tsp_lab0` PDF had Figure 1 on page 5 and its caption on
page 6. A fresh build from a temporary copy of the report modules passed native
Word acceptance at 9 pages. In its PDF, Figure 1 and the caption are together on
page 6. Table text on pages 6–7 keeps `users.password_hash`, `VARCHAR(254)`, and
`route_places.position` intact. This verifies the new image `keepNext` and table
width allocation in this report with the current Word and printer settings.

The earlier PDF split Table 1 across pages 6–7 and repeated its header without
the `Продолжение таблицы 1` label required by STO §6.2.12. The Word acceptance
path first tries moving a captioned table to the next page when it fits there.
For a longer table, it splits at a page boundary, repeats the header, and adds
`Продолжение таблицы N` before each later segment. Portable PowerShell and
launcher tests pass. A native Word acceptance of lab0 passed at 9 pages: Figure 1
and its caption remain on page 6, and the complete Table 1 with its caption is
on page 7. The coursework's three-page Table 4 supplies the native long-table
sample: all three segments occupy one page each, and the saved document reopened
with a stable page count.

## Conditional forms and visual comparison

The NIR plan, supervisor review, and statement are separate conditional forms.
They are not inserted into the general report. The bachelor and master VKR
profiles have distinct title paths and generator tests. Exact official title
geometry, especially the master form, still needs a matched reference.

The visual comparison harness checks matching content and render context before
pixel comparison. No controlled golden PDF pair exists yet. Its unit tests do
not close `SUP-V07`.
