# Python Post-Build Architecture

`scripts/post_build.py` is a compatibility entrypoint only. Keep report-specific Word automation behind the `sto_post_build` package.

## Pipeline Boundaries

- Source preflight owns Markdown/config mistakes that can be found before DOCX generation: structure, citations, labels, bibliography, formulas, lists, appendices and soft STO text warnings.
- TypeScript generation owns deterministic document structure: title page, styles, numbering, bibliography insertion, formula/table/figure blocks and page setup.
- Python post-build owns Word-dependent repair and normalization after the DOCX exists: field updates, Word formula repair, TOC, image/table normalization and PDF export.
- DOCX validator owns final XML assertions after unpacking: actual styles, section margins, page numbering, captions, fields, table/image layout and generated citation/math integrity.
- Do not move business rules into post-build only because they are convenient there. Prefer source preflight for authoring errors and DOCX validator for final layout assertions.

## Module Boundaries

- `cli.py` parses CLI arguments, prints errors and summaries, and returns process exit codes.
- `orchestrator.py` owns the post-build workflow order: formula repair, XML normalization, Word automation, dirty-field cleanup.
- `models.py` contains immutable result DTOs used between modules.
- `constants.py` contains Word constants, XML namespaces, and stable post-build constants.
- `markdown_formulas.py` extracts and normalizes LaTeX formulas from modular Markdown sources.
- `math_conversion.py` converts LaTeX to MathML through MathJax and MathML to Office Math through the repository npm dependency `@hungknguyen/mathml2omml`; do not depend on a local Microsoft Office XSL path.
- `docx_package.py` reads and rewrites DOCX ZIP parts and clears dirty Word field flags.
- `xml_layout.py` performs pure DOCX XML normalization and counts figures, tables, and used sources. Source count is derived from the highest generated citation number, because TypeScript emits only cited bibliography records and numbers them densely by first use. Add XML-only fixes here when Word COM is not needed.
- `word_automation.py` contains all `win32com`/Word COM operations: TOC update, table header repeat, image normalization, small-table keep-together handling and PDF export.

## Document-Control Notes

- Page margins, page-number footer placement, hidden title-page number, caption adjacency and style conformance are validator responsibilities. Post-build may normalize them only if Word/COM is required.
- Repeated table headers are normalized in Word COM and verified by the DOCX validator.
- Table spacing after data tables is an XML normalization step because it does not require Word pagination.
- Future no-break number/unit normalization should live in `xml_layout.py` if it can be applied safely to `w:t` runs without breaking formulas, URLs or table machine data.
- Appendix-local numbering should be implemented in the TypeScript parser/reference registry first; post-build should not infer appendix numbering from rendered text.

## Change Rules

- Do not add business logic to `scripts/post_build.py`; add it to the smallest matching module.
- Keep `win32com` imports inside `word_automation.py` so non-Windows checks can import the rest of the package.
- Prefer pure XML changes in `xml_layout.py` when Word COM is not required.
- Return dataclasses from orchestration boundaries instead of passing loose tuples.
- Update `format_post_build_summary` when adding a new post-build metric.
- Run Python quality after changes: `npm run python:quality` in a normal environment with `uv`, or Ruff/MyPy directly from a local venv.
