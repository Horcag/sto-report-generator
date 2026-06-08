---
name: sto-report-generator
description: 'Use this skill when working with the STO Report Generator repository: building or updating Russian academic .docx/.pdf reports from modular Markdown, scaffolding report folders, fixing СТО/ГОСТ formatting issues, synchronizing report figures from notebooks, validating generated DOCX files, adapting the generator code, or applying lessons from vkr-author without switching to its Pandoc pipeline.'
---

# STO Report Generator

## Purpose

Use this repository-specific workflow for reports, course papers, NIR texts, DOCX output, and PDF previews assembled by
this generator repository.

This is not the `vkr-author` workflow. `vkr-author` was used as a source of useful checks, but this repository has its
own TypeScript generator, Python post-build step, Word COM PDF export, FSD-like architecture, Steiger architecture
checks, and STO validator.

## Repository Map

Read `references/repository-map.md` when changing code, adding a new report, or debugging a build.

Core paths:

- `src/index.ts` - CLI entrypoint: `new`, `check`, `build`, `generate`, and `validate-docx` commands.
- `src/app/builder.ts` - report assembly: sorted `.md` files, metadata, title page, DOCX packer.
- `src/app/report-scaffold.ts` - portable report folder scaffolding with `nir`, `coursework`, and `lab` profiles,
  templates, `report.config.json`, local `.gitignore`, and optional nested `git init`.
- `src/app/report-workflow.ts` - high-level `generate` orchestration from source preflight through DOCX validation.
- `src/features/markdown-parser/` - Markdown, citations, formulas, tables, images, STO flags.
- `src/shared/lib/report-config.ts` - resolved report profiles/config; keep report-specific overrides portable and relative.
- `src/shared/config/sto-rules.json` - portable STO constants used by formatting, parser guards, preflight checks and
  DOCX validation.
- `docs/sto-rules-coverage.md` - audit of STO rules already transferred from extracted standards and rules still worth automating.
- `src/shared/config/sto-styles.ts` - DOCX styles and numbering derived from shared STO constants where practical.
- `scripts/post_build.py` - compatibility entrypoint for Word post-build.
- `scripts/sto_post_build/` - Python post-build package: formula repair, DOCX XML normalization, Word COM automation, dirty field cleanup, and PDF export.
- `src/shared/lib/sto-validator.ts` - XML-level STO checks after unpacking the `.docx`.
- `tests/source-preflight/regression_checks.ts` - source Markdown preflight checks before final build.
- `steiger.config.ts` - Feature-Sliced Design architecture checks.
- `.pre-commit-config.yaml` - pre-commit/pre-push quality gates.
- `reports/<report_name>/` - local report modules and images. Treat these as user/private working material.

## Standard Workflow

- Install dependencies when preparing a fresh checkout:

```powershell
npm install
uv sync
npm run hooks:install
```

- For a new report, scaffold the folder instead of copying an old report by hand:

```powershell
npm run new:report -- <report_name> --profile coursework --dir reports/<report_name> --title "<topic>"
```

Use `--profile nir`, `--profile coursework`, or `--profile lab`. `lab` intentionally omits referat/sources until
citations require them. `--type` changes title-page text only; it is not a profile selector.

- Inspect the target report directory and edit the smallest relevant `.md` modules. Do not rewrite a whole report in one
  file.
- If figures come from a notebook, refresh or sync figures before building the DOCX. For report-specific figure scripts,
  install optional dependencies with `uv sync --group figures` if needed.
- Run source preflight:

```powershell
npm run check:source -- reports/<report_name>
```

- Prefer the high-level generator for normal builds. It reads `report.config.json`; keep that file portable and
  relative, with no personal absolute paths. `check` and `generate` both use the same resolved profile/config:

```powershell
npm run generate:report -- reports/<report_name> --post-build --validate
```

- Use lower-level commands only when debugging a specific step:

```powershell
npx tsx src/index.ts build reports/<report_name> reports/<report_name>/build/<output>.docx
uv run python scripts/post_build.py reports/<report_name>/build/<output>.docx reports/<report_name>
npm run validate:docx -- reports/<report_name>/build/<output>.docx .agent-work/<report_name>_unpacked
```

- For code changes, run the non-Word quality gate:

```powershell
npm run quality
```

- For `reports/coursework_sad`, verify notebook figures if they were touched:

```powershell
uv run python reports/coursework_sad/scripts/verify_docx_figures.py reports/coursework_sad/coursework_sad.docx
```

## Supported STO Markdown Elements

These are generator-specific Markdown macros, not general Markdown or full LaTeX. Unknown environments must fail fast.

- `\sto_structural_heading{СОДЕРЖАНИЕ}` - structural unnumbered heading, with TOC generation for `СОДЕРЖАНИЕ`.
- `\begin{sto_bibliography}...\end{sto_bibliography}` - generated bibliography from cited BibTeX keys. Keep the block empty in `91_sources.md`; the parser fills it with used sources only.
- `\begin{sto_list}...\end{sto_list}` - STO bullet list; use raw Markdown bullets only inside this block.
- `\begin{sto_enum}...\end{sto_enum}` - STO ordered list; use raw Markdown numbering only inside this block.

The allowed environments are configured in `src/shared/config/sto-rules.json`. Keep that config portable; do not put
local absolute paths there.

## Report Editing Rules

- Keep the report modular: metadata, referat, intro, data, methodology, results, discussion, conclusion, sources.
- Every table and figure must be mentioned in the text before it appears.
- Use en-dash `–`, not em-dash `—`.
- Use BibTeX cite keys in text: `[@key]` or `[@key1; @key2]`. Do not write source numbers like `[1]` manually in source Markdown.
- Do not use `[0]` citations.
- Keep `91_sources.md` as an empty `sto_bibliography` container; unused entries may remain in `references.bib`.
- For cited BibTeX entries, keep required fields complete enough for GOST/STO formatting: books need author/editor,
  title, place, publisher, year and pages; articles need journal/year/pages; conference or collection parts need
  `booktitle`, place, year and pages. Electronic sources need `url` with `http`, `https` or `ftp` and `urldate` as
  `YYYY-MM-DD`.
- Store DOI values without `https://doi.org/`; English sources should normally have `langid = {english}`. If a source is
  a working paper, preprint, SSRN, arXiv or NBER item, prefer `techreport`, `misc` or `online` over `article`.
- For `lab`, sources are optional until the first `[@key]` citation. After adding a citation, add `references.bib` and a
  `СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ` structural section unless config explicitly says otherwise.
- Use `\begin{sto_list}` / `\begin{sto_enum}` for lists. Add an introductory sentence ending in `:` or `.`, do not leave
  a trailing preposition before the list, do not write `1).`, keep markers sequential, do not mix marker styles at one
  indentation level, and make the last list item end with a period.
- Avoid bold Markdown outside `01_referat.md`; the parser treats bold in regular text as an STO violation.
- Put code and technical file-size audit details outside the final report unless they are substantively needed.
- After a formula followed by a lowercase `где`, do not end the formula with a period and do not write `где:`. In LaTeX
  formulas, write upright functions as commands (`\sin`, `\ln`, `\max`) and use `\ldots`, `\dots` or `\cdots` instead
  of raw `...`. Do not use raw `×`, `∙` or `…`; do not put `\cdot` between a number and a letter symbol.
- Prefer Russian terms in the report when a standard Russian equivalent exists.
- Do not use unknown `\begin{...}` environments; add them to `sto-rules.json`, parser handling, tests, and README
  together if support is needed.

## Code Change Rules

- Keep generator changes in the existing architecture: TypeScript builds the DOCX, Python `scripts/sto_post_build/` only fixes Word-specific post-processing issues and exports PDF. Keep `scripts/post_build.py` as a thin compatibility entrypoint.
- Respect the FSD-like layers: `app` orchestrates, `features` implement report-building capabilities, `entities` hold
  domain types, `widgets` hold large DOCX blocks, `shared` holds infrastructure/config/validators.
- Run `npm run fsd:check` after moving files across layers or changing imports.
- Add or update checks in `tests/source-preflight/` for source Markdown problems and
  `tests/validator/` plus `src/shared/lib/sto-validator.ts` for generated DOCX XML problems.
- Put reusable STO constants into `src/shared/config/sto-rules.json` when they are stable and portable. Keep
  report-specific values in report files, not in shared config.
- Put report-type behavior into `src/shared/lib/report-config.ts` profiles or `report.config.json`, not into ad hoc
  checker branches.
- Do not import the `vkr-author` Pandoc/Lua pipeline into this repository unless the user explicitly asks for a second
  build system.

## vkr-author Lessons

Read `references/vkr-author-adapted-features.md` when deciding whether a `vkr-author` feature belongs here. The short
version:

- Adopted: repeated table headers, image centering/width checks, dirty field checks, source Markdown checks for hanging
  references, em-dash, `[0]`, bold, missing images, unsupported STO environments, formula punctuation, tabs, and empty
  DOCX table cells.
- Not adopted: Pandoc/Lua build pipeline, empty-alt-image rule, Beads task workflow, and Claude-specific project
  scaffolding.
