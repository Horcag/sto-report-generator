# Repository Map

## Build Pipeline

`src/index.ts` receives:

- input path: a single `.md` file or a directory with sorted `.md` modules;
- output path: target `.docx`.

`src/app/builder.ts` reads Markdown modules, takes the first non-empty YAML frontmatter as metadata, creates the title page, parses Markdown into DOCX elements, and writes the final file with `docx`.

`scripts/post_build.py` must be run after DOCX generation when the result is intended for review or submission. It opens Word through COM, updates the table of contents, computes page count, replaces `{{PAGES}}`, `{{FIGURES}}`, `{{TABLES}}`, `{{SOURCES}}`, repeats first rows in tables, centers/scales inline images, and clears dirty field flags.

`npm run unpack -- <docx> <dir>` unpacks the generated DOCX for XML validation.

`npm run validate:sto -- <unpacked_dir>` checks generated XML for STO constraints.

## Report Directory Convention

Reports are modular. Typical files:

- `00_metadata.md` - YAML metadata, bibliography path, title-page fields.
- `01_referat.md` - abstract/referat, usually with placeholders.
- `02_toc.md` - table of contents marker.
- `02b_abbreviations.md` - optional abbreviations.
- `03_intro.md` - introduction.
- `04_data_description.md` / `20_data.md` - data description and preparation.
- `10_methodology.md` - methods, formulas, hypotheses.
- `30_results.md` - tables, figures, results and interpretations.
- `40_discussion.md` - limitations and discussion.
- `90_conclusion.md` - conclusion.
- `91_sources.md` - bibliography block.

Edit the narrowest file that owns the content. Do not make large generated notebooks or one-file reports unless the user explicitly asks.

## Coursework SAD Figure Workflow

For `reports/coursework_sad`, figures can be refreshed in two ways:

- `reports/coursework_sad/scripts/sync_notebook_figures.py` extracts PNG outputs from `local coursework notebook` into `reports/coursework_sad/images` and writes `manifest.json`.
- `reports/coursework_sad/scripts/refresh_report_figures.py` regenerates selected figures from staged CSV outputs in `local staged CSV outputs`.
- `reports/coursework_sad/scripts/verify_docx_figures.py` compares PNG hashes embedded in the DOCX with `images/manifest.json`.

Use `sync_notebook_figures.py` when the notebook is the source of truth for all current figures. Use `refresh_report_figures.py` only when the staged outputs are known to be current and the report needs regenerated plots without notebook execution.

## Validation Commands

Full coursework check:

```powershell
npx tsx tests/regression_checks.ts reports/coursework_sad
npx tsx src/index.ts reports/coursework_sad reports/coursework_sad/coursework_sad.docx
uv run --with pywin32 --with lxml python scripts/post_build.py reports/coursework_sad/coursework_sad.docx
npm run unpack -- reports/coursework_sad/coursework_sad.docx .temp_coursework_docx
npm run validate:sto -- .temp_coursework_docx
uv run python reports/coursework_sad/scripts/verify_docx_figures.py reports/coursework_sad/coursework_sad.docx
```

Generator smoke tests:

```powershell
npm run test:generator
npm run test:toc
npm run test:bib
```

`npm run test:validator` currently targets an older Python validator path and may be stale. Prefer the XML validator command above unless the test harness is updated.
