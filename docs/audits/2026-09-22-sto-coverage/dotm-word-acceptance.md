# Word comparison with the 2022 DOTM styles

## Reproduction and evidence boundary

`tests/workflow/dotm_word_corpus.py build` builds one source corpus twice. The generator
document uses its own paragraph styles. The comparison document starts from the same
generated package and visible text, then applies the paragraph styles, document defaults,
and numbering definitions from
`tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm`
(SHA-256 `a8a06c6e9c273149b0ba8629e2552b4fce563916921391dcb51027dc8175b261`).
The comparison is a **DOTM-style reference**, not a document manually authored from the
DOTM. This isolates style geometry while holding content, page setup, and embedded media
fixed; it does not test all template relationships, macros, theme behavior, or Word's
"New from template" action.

The source corpus in `tests/fixtures/dotm-word-corpus/` includes title and body text,
referat keywords, a cited bibliography entry, an image and figure caption, a 31-row
table and caption, heading levels 1–6, and explicit TOC1–4 tab probes. Before Word,
the 126 visible paragraph strings were identical. The builder fails if any of the
17 mapped styles is unused, or if the DOTM keyword and bibliography styles are unused.
The generated TOC field adds six paragraphs during Word update; the 132 paragraphs in
the two accepted DOCX files have exactly equal visible text, including the referat's
`8 с., 1 рисунок, 1 таблица, 1 источник` line.

The exact commands, run from the repository root, are:

```sh
uv run python tests/workflow/dotm_word_corpus.py build
npm run accept:word -- .agent-work/dotm-word-corpus/generator.docx --accepted-docx .agent-work/dotm-word-corpus/generator.accepted.docx --pdf .agent-work/dotm-word-corpus/generator.accepted.pdf --manifest .agent-work/dotm-word-corpus/generator.acceptance.json
npm run accept:word -- .agent-work/dotm-word-corpus/dotm-reference.docx --accepted-docx .agent-work/dotm-word-corpus/dotm-reference.accepted.docx --pdf .agent-work/dotm-word-corpus/dotm-reference.accepted.pdf --manifest .agent-work/dotm-word-corpus/dotm-reference.acceptance.json
uv run python tests/workflow/measure_dotm_word_corpus.py .agent-work/dotm-word-corpus/generator.accepted.docx .agent-work/dotm-word-corpus/dotm-reference.accepted.docx .agent-work/dotm-word-corpus/generator.accepted.pdf .agent-work/dotm-word-corpus/dotm-reference.accepted.pdf --output docs/audits/2026-09-22-sto-coverage/dotm-word-acceptance-measurements.json
```

Run the two Word commands sequentially. The measurement command rejects unequal
accepted text and writes [the detailed measurements](dotm-word-acceptance-measurements.json).
Word manifests are under `.agent-work/dotm-word-corpus/`.

## Word acceptance

| Check                          |                                                          Generator |                                               DOTM-style reference |
| ------------------------------ | -----------------------------------------------------------------: | -----------------------------------------------------------------: |
| Word version/build             |                                                  16.0 / 16.0.20326 |                                                  16.0 / 16.0.20326 |
| Printer                        |                                                  OneNote (Desktop) |                                                  OneNote (Desktop) |
| Pages, before/after reopen     |                                                              8 / 8 |                                                              8 / 8 |
| PDF pages                      |                                                                  8 |                                                                  8 |
| Referat figures/tables/sources |                                                          1 / 1 / 1 |                                                          1 / 1 / 1 |
| Word process cleanup verified  |                                                                yes |                                                                yes |
| Accepted DOCX SHA-256          | `42b961a9c1f04d9ce413f5f3fa9125d2741d6698e85f7a70c8fda69fa8c8a8aa` | `455df391f8e83e3268196d82e36406613bd6126ad9a4b2b37a99d7b49e82423a` |
| PDF SHA-256                    | `b1822bf8332fe1636c991fcb217e551100254cb076cfb7f6d755f76eb4312746` | `f39be7a2322fa68df42232d316956e95954c3f0d17c6837d0c6821cde5d4ac71` |

Both acceptance manifests have `status=accepted`, all capability checks true,
`stablePageCount=true`, and `execution.processCleanupVerified=true`. Word reported an
Office license diagnostic warning (`0xC004F009`) but opened, updated, saved,
reopened, and exported both documents. PDF text extraction places the figure caption
on page 5, the table caption and last table row on page 6, and the bibliography on
page 8 in both outputs. ZIP/XML inspection finds one table with 31 rows and 62
table-cell paragraphs in each accepted DOCX.

## Style use and measured geometry

The accepted documents use all 17 mapped style families: body, title, two structural
headings, figure/table captions, table text, heading levels 1–6, and the four explicit
TOC probes. The DOTM-style reference also uses the DOTM keyword and bibliography
styles once each. Word renumbered internal style IDs on save, so use is verified by
the actual paragraph style's display name and effective `w:pPr`, not by raw ID
equality. The generated TOC also uses Word's own `toc 1`–`toc 4` styles (4/1/1/1
paragraphs). These are measured separately from the explicit `+Оглавление 1`–`4`
probes (one each).

Measurements are in twentieths of a point (`twips`):

| Paragraph family       | Generator                                                   | DOTM-style reference                                               | Disposition                                                       |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Figure caption         | centered, first line 0, 120 before / 240 after, line 240    | same                                                               | equal                                                             |
| Table caption          | left, first line 0, 120 before / 120 after, line 240        | same                                                               | equal                                                             |
| Table text             | left, first line 0, line 240                                | same                                                               | equal                                                             |
| Explicit TOC2–4 probes | left indents 284 / 567 / 851; right dot tab 9356; line 360  | same positions and line 360; no explicit `jc` or `firstLine=0`     | no measured position delta; omitted XML properties need no defect |
| Word-generated TOC2–4  | left indents 280 / 560 / 840; right dot tab 9345; 100 after | left indents 284 / 567 / 851; right dot tab 9356; no after spacing | open layout difference; see below                                 |
| Heading levels 5–6     | first line 709, left, line 360                              | first line 709, justified, 200 before, line 360                    | documented generator heading-level adaptation; see below          |

The measurement JSON records every used style, count, representative text, and
effective paragraph-property variant. Its effective property resolver includes
`docDefaults`, the `basedOn` chain, and direct paragraph properties. It does not
resolve numbering-level indentation, so missing `w:ind` on the DOTM heading 1–4
style is not proof of a zero visual indent. These heading levels remain an open
numbering-geometry measurement gap, while both documents paginate to eight pages.

## Remaining differences

The numeric and property comparisons preceding this Word test are in
[dotm-numeric-deltas.csv](dotm-numeric-deltas.csv) and
[dotm-property-deltas.csv](dotm-property-deltas.csv). The Word result groups the
observed differences as follows:

- The generator's title-page paragraphs contain direct alignment, indent, tab, and
  spacing overrides. The DOTM-style reference uses the canonical title style with
  fewer direct overrides. These are generated front-matter layout choices from
  `src/widgets/title-page/lib/title-page.ts` and `src/shared/config/sto-styles.ts`; exact normative
  justification for each override remains open in the source delta CSVs.
- The keyword and bibliography paragraphs deliberately use separate DOTM styles in
  the reference. The generator routes those text paragraphs through its body style;
  the DOTM mapping and its adaptation status are documented in
  `docs/architecture/dotm-template-style-audit.md`. Their styles are actually used
  here; visual equivalence of those paragraphs is not inferred from the equal page
  count.
- Word-generated TOC tabs and indents differ by 4–11 twips and 100 twips of after
  spacing, as measured above. The explicit mapped TOC probes preserve the canonical
  DOTM tab positions. The generated-field difference is an **open layout defect**;
  there is no identified normative source authorizing the smaller generator values.
- Heading levels 5–6 differ in alignment and before spacing. The generator's
  heading-level policy is recorded in
  `docs/architecture/dotm-template-style-audit.md`; whether that adaptation is
  acceptable against the governing STO remains open. Numbering-level geometry for
  headings 1–4 also needs measurement beyond `w:pPr`.

Raw DOCX XML inequality is not treated as a visual defect. The remaining open
items above limit this result to a reproducible Word comparison and measured
style coverage; they do not establish full DOTM conformance.
