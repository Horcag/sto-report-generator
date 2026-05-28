---
name: sto-report-generator
description: 'Use this skill when working with the local STO Report Generator repository at local sto-report-generator workspace: building or updating Russian academic .docx reports from modular Markdown, fixing СТО/ГОСТ formatting issues, synchronizing report figures from notebooks, validating generated DOCX files, adapting the generator code, or applying lessons from vkr-author without switching to its Pandoc pipeline.'
---

# STO Report Generator

## Purpose

Use this repository-specific workflow for reports, courseworks, NIR texts, and DOCX output that are assembled by `local sto-report-generator workspace`.

This is not the `vkr-author` workflow. `vkr-author` was used as a source of useful checks, but this repository has its own TypeScript generator, Python post-build step, and STO validator.

## Repository Map

Read `references/repository-map.md` when changing code, adding a new report, or debugging a build.

Core paths:

- `src/index.ts` - CLI entrypoint: input markdown file/directory plus output `.docx`.
- `src/app/builder.ts` - report assembly: sorted `.md` files, metadata, title page, DOCX packer.
- `src/features/markdown-parser/` - Markdown, citations, formulas, tables, images, STO flags.
- `scripts/post_build.py` - Word COM post-processing: TOC, page/figure/table/source placeholders, table headers, image normalization, dirty field cleanup.
- `src/shared/lib/sto-validator.ts` - XML-level STO checks after unpacking the `.docx`.
- `tests/regression_checks.ts` - source Markdown preflight checks before final build.
- `reports/<report_name>/` - local report modules and images. Treat these as user/private working material.

## Standard Workflow

1. Inspect the target report directory and edit the smallest relevant `.md` modules. Do not rewrite a whole report in one file.
2. If figures come from a notebook, refresh or sync figures before building the DOCX.
3. Run source preflight:

```powershell
npx tsx tests/regression_checks.ts reports/<report_name>
```

4. Build the DOCX:

```powershell
npx tsx src/index.ts reports/<report_name> reports/<report_name>/<output>.docx
```

5. Run post-build:

```powershell
uv run --with pywin32 --with lxml python scripts/post_build.py reports/<report_name>/<output>.docx
```

6. Unpack and validate:

```powershell
npm run unpack -- reports/<report_name>/<output>.docx .temp_<report_name>_docx
npm run validate:sto -- .temp_<report_name>_docx
```

7. For `reports/coursework_sad`, verify notebook figures if they were touched:

```powershell
uv run python reports/coursework_sad/scripts/verify_docx_figures.py reports/coursework_sad/coursework_sad.docx
```

## Report Editing Rules

- Keep the report modular: metadata, referat, intro, data, methodology, results, discussion, conclusion, sources.
- Every table and figure must be mentioned in the text before it appears.
- Use en-dash `–`, not em-dash `—`.
- Do not use `[0]` citations.
- Avoid bold Markdown outside `01_referat.md`; the parser treats bold in regular text as an STO violation.
- Put code and technical file-size audit details outside the final report unless they are substantively needed.
- After a formula followed by a lowercase `где`, do not end the formula with a period.
- Prefer Russian terms in the report when a standard Russian equivalent exists.

## Code Change Rules

- Keep generator changes in the existing architecture: TypeScript builds the DOCX, Python `post_build.py` only fixes Word-specific post-processing issues.
- Add or update checks in `tests/regression_checks.ts` for source Markdown problems and `src/shared/lib/sto-validator.ts` for generated DOCX XML problems.
- Do not import the `vkr-author` Pandoc/Lua pipeline into this repository unless the user explicitly asks for a second build system.

## vkr-author Lessons

Read `references/vkr-author-adapted-features.md` when deciding whether a `vkr-author` feature belongs here. The short version:

- Adopted: repeated table headers, image centering/width checks, dirty field checks, source Markdown checks for hanging references, em-dash, `[0]`, bold, and missing images.
- Not adopted: Pandoc/Lua build pipeline, empty-alt-image rule, Beads task workflow, and Claude-specific project scaffolding.
