# vkr-author Feature Review

Source reviewed: `tssvett/vkr-author`.

The repository was useful as a checklist for academic DOCX production, but it should not become a runtime dependency of `sto-report-generator`.

## Adopted Into sto-report-generator

### DOCX post-processing

Implemented in `scripts/post_build.py`:

- repeat first table row as a Word header row;
- center inline images;
- scale images wider than 14 cm;
- clear `w:dirty="true"` / `w:dirty="1"` field flags after Word field updates.

### Generated DOCX validation

Implemented in `src/shared/lib/sto-validator.ts`:

- formula before lowercase `где` must not end with a period;
- dirty Word fields are rejected;
- tables without repeated header rows are rejected;
- images wider than 14 cm are rejected;
- image paragraphs without center alignment are rejected.

### Source Markdown preflight

Implemented in `tests/source-preflight/regression_checks.ts`:

- no unresolved source markers;
- no em-dash `—`;
- no citation `[0]`;
- no bold Markdown outside `01_referat.md`;
- local image paths must exist;
- table and figure references must appear before the table/figure.

## Not Adopted

### Pandoc/Lua pipeline

`vkr-author` builds through Pandoc, Lua filters, and a reference `.docx`. This conflicts with the current TypeScript `docx` architecture. Keep one build pipeline unless the user explicitly asks for a second compiler.

### Empty image alt text

In Pandoc, non-empty image alt text can become an unwanted caption. In this generator, `handleImage()` ignores alt text and captions are written as explicit `Рисунок N – ...` paragraphs. Therefore the empty-alt rule is not enforced.

### Beads workflow

The Beads task setup is useful for full диплом projects, but it is not part of the report generator's build or validation path.

### Claude-specific scaffolding

`CLAUDE.md.template` and Claude-oriented wording were not transferred. The local skill uses Codex-oriented instructions and paths for this repository.

## Future Candidates

Consider later if they become necessary:

- paragraph-length preflight for very long academic paragraphs;
- check that table captions either cite a source or clearly state that values are calculated by the author;
- stricter bibliography checks for ГОСТ formatting;
- automated visual QA by rendering DOCX pages to images.
