# Wordcraft integration checks, 17 October 2026

## Evidence scope

The rendering observations below were collected during the experiment **before integration with
master `8726623`**. They are historical evidence for those tested artifacts, not acceptance of the
integrated revision. Final integrated quality and live checks are pending.

The experiment used Wordcraft CLI **0.7.0**, release commit
`fc41918814f62645b6746ed68e71e8c2c2e85d6f`, in Linux/WSL, with a native Windows
Microsoft Word 16.0 build 16.0.20430 comparison. Native Wordcraft on Windows/macOS was not run.

## Historical rendered documents

| Pre-integration control                 | Wordcraft PDF pages | Independent PDF check                                                   | Microsoft Word comparison             |
| --------------------------------------- | ------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| Public `example` at the tested revision | 8                   | 8 pages; correct referat count; TOC entries; one figure                 | Accepted; 8 pages before/after reopen |
| Style corpus extended to 90 table rows  | 10                  | All 90 rows; three table pages; header repeated on each                 | Not run for this extended control     |
| Math/appendix control                   | 5                   | 5 pages; cleared statistics; appendix TOC entry; equation page rendered | Accepted; 5 pages before/after reopen |

Independent inspection used pypdf 6.10.0 for page trees, searchable text and image resources,
and PDFium through pypdfium2 5.14.0 to render representative pages. These tools came from the
local document runtime; they are not production dependencies or automatic runtime checks.

The example and formula controls passed the bounded `accept:word` launcher during that experiment.
Their receipts reported successful save/reopen, stable page totals, style/font checks and
`processCleanupVerified: true`. Exported file hashes were read back and matched the receipts.
The Office license diagnostic reported a warning; actual open/update/save/reopen/export capabilities passed.

Matching page totals on these documents does not establish matching line breaks or full Word fidelity.
The Linux PDFs used Liberation Serif and DejaVu math substitutions. Font installation remains part
of a reproducibility comparison.

## Findings and integrated behavior

1. **SVG bytes mislabeled as PNG could hide a figure.** This was reproduced on the older image handler.
   An experimental rasterization repair restored the example's figure on page 6 in the historical run.
   Current master already validates real PNG companions, including aspect ratio, quality and hashes.
   Integration preserves that planner and its SVG baseline diagnostics. Automatic PNG generation and
   its additional rasterization dependency were removed. SVG sources require their configured or
   adjacent PNG companion; missing or invalid companions fail the build.
2. **Math environments were mistaken for STO blocks.** Matrices failed before reaching conversion.
   Shared math/code masking keeps them in the formula path while rejecting unsupported STO blocks
   outside formulas. Regression tests cover escaped dollar signs, multiline inline math and original
   diagnostic line numbers. These focused checks passed after conflict resolution.
3. **Statistic extraction could leave temporary files after timeout.** The helper runs Python directly
   and places temporary extraction directories inside renderer-owned staging. A pre-integration timeout
   probe with 20,000 small media entries left zero extraction/staging directories after that repair.

## Verification status after integration

- Focused parser, math/preflight, figure planning and SVG baseline tests passed after conflict resolution.
- The normal runner includes launcher/configuration behavior, failure preservation, deadline handling,
  page convergence, source immutability and the existing PNG companion checks.
- `npm run test:wordcraft` exercises the installed engine on the three public controls and removes output.
- Earlier coverage of 89.73% lines, 97.06% functions and 82.46% branches belongs to the pre-integration
  revision. It does not establish coverage of the integrated revision.
- The earlier file-size failures and 11 npm advisories were superseded by current master. The current
  file-size gate passes and npm audit reports zero advisories. They are no longer outstanding blockers.
- The integrated `npm run quality` passed: all 36 TypeScript test commands, 9 quality-policy and
  34 Python regression tests executed. Coverage was 90.56% lines, 97.14% functions and 83.38% branches.
  Formatting, lint, typechecking, architecture, package contents, file size, links, spelling and audit passed.
- A fresh live run with docx 9.12.0 passed all three controls: example 8 layout pages, 90-row corpus
  11 layout pages, and math/appendix control 5 layout pages. Source and PDF hashes passed.
  Those page counts are engine reports; the production manifest still marks independent PDF verification false.
- Native Word 16.0.20430 accepted the example control at a stable 8 pages with process cleanup verified.
  A small SVG viewport had made Word reduce its PNG preview. The example now uses a 1200x600 viewport
  with its original 400x200 viewBox: source SVG and geometry were preserved, and the accepted preview
  increased from 1200x600 to 2400x1200. The integrity validator was not relaxed.

## Tooling compatibility

The integrated dependencies include docx 9.12.0, jsdom 30.1.3, marked 18.1.1, the maintained gray-matter
fork 3.0.0, js-yaml 5.5.0, Steiger 0.7.0 and its FSD plugin 0.8.0. Steiger now loads an explicit ESM
configuration. A shared YAML adapter retains timestamp and anchor-merge semantics across the major
upgrade. The new docx cached TOC entries are checked separately from numbered body headings; golden
XML changes were reviewed for text, formulas, bookmarks, relationships and table widths.

The obsolete adm-zip type stub was removed because the runtime package provides its own declarations.
TypeScript remains 6.0.3: current typescript-eslint 8.71.2 declares support below 6.1, so forcing TypeScript 7
would install an unsupported dependency tree. No audit threshold or compatibility check was disabled.

## Decision

Keep Wordcraft opt-in and version-pinned. Preserve the original DOCX, existing figure controls and
Word acceptance path. Expand the comparison corpus before promoting Wordcraft to a default renderer
or promising interchangeable pagination.

Implementation and commands: [Wordcraft renderer](../architecture/wordcraft-renderer.md).
