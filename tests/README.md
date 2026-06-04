# Test Layout

The root `tests/run_all_tests.ts` is only an orchestrator. Put new checks in the closest package:

- `source-preflight/` - source Markdown checks before DOCX generation.
- `parser/` - Markdown-to-DOCX block parsing and rejection cases.
- `validator/` - unpacked DOCX/XML STO validation rules.
- `generator/` - generated DOCX regression and snapshot checks.
- `scaffold/` - report folder scaffolding checks.
- `bibliography/` - bibliography formatting rules.
- `fixtures/` - shared DOCX/XML snapshots and negative fixtures.

Prefer small package-level runners over adding logic to `run_all_tests.ts`.
