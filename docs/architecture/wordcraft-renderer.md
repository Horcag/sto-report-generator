# Experimental Wordcraft PDF renderer

Wordcraft is an optional local renderer. The TypeScript generator remains the owner of DOCX structure,
STO styles, bibliography and OMML. Wordcraft does not replace the Markdown parser, XML validator or
the separate Microsoft Word acceptance command.

## Runtime contract

- Supported CLI: **0.12.0**, release commit `3de6ff95af86c19d67030cd96dba15cd6a45a25e`.
- Install `wordcraft-cli` from its [official release](https://github.com/storytold/wordcraft/releases/tag/v0.12.0).
  Use `PATH`, `WORDCRAFT_CLI`, or the `--wordcraft` argument. Nothing is downloaded at render time.
- Run `uv sync` in the generator installation directory. The renderer executes that directory's
  `.venv` Python directly; the helper uses the existing XML/statistics package and never invokes COM.
- Select `--renderer wordcraft` for `generate`, `audit` or `preview`. The existing portable default
  and LibreOffice preview default remain available. Word COM post-build cannot be combined with Wordcraft.
- The default outputs are `report.wordcraft.pdf` and `report.wordcraft.json`. A `--pdf` override derives
  its JSON path from the chosen PDF basename. Rendering never writes back to the source DOCX.
- `--font-dir /path/to/fonts` or `WORDCRAFT_FONT_DIR` supplies local font files for `generate`, `audit`
  and `preview`. `--strict-fonts` rejects unavailable families or font requirements that preflight
  cannot verify. These controls apply only to the Wordcraft renderer.

## Render sequence

1. Check executable version and output destinations.
2. Create a temporary directory beside the output, preserving the original DOCX hash.
3. Rebuild a temporary copy from the original for each iteration. Fill statistic placeholders with
   the existing count/pluralization rules, including placeholders split across XML runs.
4. Query the engine's font catalog. Select local files for missing families when supplied, load them,
   query the catalog again, and enforce strict mode when requested. Reuse the selected fonts in every
   layout, field-update and export command.
5. Run `references.updateFields` explicitly. A plain Wordcraft `convert` does not update the TOC.
6. Probe supported numbered tables on physical pages, split at safe row boundaries, add continuation
   captions and repeated headers, and refresh fields after each layout change.
7. Reopen the staged document to measure layout pages, export PDF, and repeat the layout measurement.
   Use `document.layout` when loading explicit fonts; otherwise use `info`.
8. Repeat from the original source with the measured page total, for at most three iterations,
   until the inserted total agrees.
9. Check the PDF signature, source hash and loaded font hashes, publish the PDF and JSON, and remove
   staging on success or failure.

One 300-second budget covers version lookup, preparation, font loading, field updates, table probes
and exports. Individual
CLI calls are synchronous, use argument arrays without a shell, and are terminated on timeout.
Existing PDF/JSON outputs survive a failed conversion. This is a bounded synchronous launcher;
it does not start the desktop app or an MCP server.

The manifest records `experimental: true`, `wordAccepted: false`, source/PDF SHA-256 hashes,
the CLI version, warnings, font evidence, table operations and the final layout count.
`pageCountSource` is `"wordcraft-info"` or `"wordcraft-document-layout"`;
`pdfPageCountVerified: false` marks independent PDF inspection as unperformed.
Before/after layout counts are a stability check on the staged DOCX; they are not PDF page counts.

## Font controls

Preflight inspects document defaults, used style chains, direct formatting, supported theme references
and mathematical font requirements. It queries `font.list` in Wordcraft; system font substitution
tools do not establish which families the engine can use. Without strict mode, missing or unresolved
requirements produce warnings in the manifest.

The optional font directory supplies TTF, OTF or TTC files. Family metadata determines which files
can supply missing families; filenames alone are insufficient. Already available families are left
in the engine catalog. Selected files load into each CLI invocation with `font.add`; no fonts are
installed globally. A collection may expose additional families, so the engine catalog is checked
after loading. The manifest records loaded file paths and SHA-256 values. Font commands travel in
bounded JSON scripts, avoiding the Windows command-line length limit.

Strict mode proves only the supported family requirements and their availability. It does not
certify font selection for every glyph, mathematical metrics, embedded/SVG fonts or Word layout parity.
Keep licensed font files local and inspect the resulting PDF resources when comparing renderers.

## Table continuation controls

The adapter recognizes top-level numbered data tables with an immediately preceding Russian caption
such as `Таблица 1 – ...` or `Продолжение таблицы 1`. Formula layout tables are excluded.
Supported tables have a contiguous repeated-header prefix and directly addressable cell paragraphs.
Multiple paragraphs per cell and horizontal spans are inspected; a continuation cannot cut a vertical
merge group. Nested tables and ambiguous containers are reported as unsupported and left unsplit.

For each candidate, `caret.set` and `document.layout` probe paragraph starts and ends in every cell.
The zero-based physical page index determines boundaries, independently of displayed page numbers.
The staged table is split only at verified safe row boundaries, with a cloned repeated header and
continuation caption. Table hashes and row counts guard each mutation. A table whose first row group
cannot fit the remaining space may be moved to a new page. An oversized row/group or a missing layout
response fails rendering rather than accepting an unverified split. Pagination is bounded to 64 splits.

The manifest's `tables` object reports splits, verified tables and warnings. Unsupported structures
do not gain a verification claim from a successful export. These repairs affect the staged copy;
they do not establish equivalence with Word's table layout or prove multi-section rendering fidelity.

## SVG fallback contract

SVG figures retain their vector source and require a real PNG companion. The figure planner uses
an explicitly configured `fallback`, or the adjacent PNG with the same basename. It validates
PNG content, aspect ratio and figure quality, records source/fallback hashes, and preserves figure
settings and SVG baseline diagnostics. Missing or invalid companions fail the build. See
[figure controls](../figure-controls.md) for configuration and quality policies.

The integrated renderer uses this existing contract. It does not create PNG companions or install
an SVG rasterization engine. The earlier experimental automatic rasterization was removed when
integrating with the current figure planner, which already rejects SVG bytes mislabeled as PNG.
Wordcraft preparation also rejects malformed PNG media from older DOCX files and asks for a rebuild
rather than silently exporting a missing figure. Keep source and companion assets together.

## Math environment boundary

The live matrix control exposed a parser defect: `\\begin{bmatrix}` inside math was classified as an
unsupported STO environment. Parser start detection and source preflight now share a math/code mask
that preserves source offsets, escapes and line breaks. Unknown environments outside math still fail
with the original source line number. A lexer-local adapter guards Marked 18's clipped `start`
callback; an explicit regression tests that dependency behavior.

See the [user compatibility matrix](../wordcraft-compatibility.md) and
[0.9.0 comparison audit](../audits/2026-10-21-wordcraft-090.md) for measured Word and platform differences.

## Compatibility boundaries

- Wordcraft is alpha. Its documentation records pagination and format-fidelity gaps.
- OMML parsing/preservation does not prove the same equation layout as Word. Check fractions,
  radicals, matrices, accents, indices, operators, inline math and equation numbers visually.
- TOC/TC support exists, but complex field switches and multi-section documents need representative tests.
- Headers, table splitting and repeated headers need rendered checks, beyond valid XML.
- Embedded DOCX fonts and SVG fonts have separate behavior. Record installed fonts when comparing pages.
- PDF signature checks do not prove complete content. Compare actual page count, searchable text,
  figure presence and rasterized pages with an independent PDF reader.
- `--validate` checks the original generated DOCX, not Wordcraft's temporary rewritten copy.
- Successful Wordcraft export is not Microsoft Word acceptance. Use `npm run accept:word -- <docx>`
  when the target requires a Word-produced accepted DOCX/PDF.

## Verification

The normal test runner includes fake-CLI failure, timeout, field-order, convergence, version and
source-preservation checks, workflow/config tests, figure planning/PNG validation, and math boundary
regressions. Executable-fixture tests report platform skips explicitly. Python tests exercise
run-split statistics and media validation.

Run the opt-in live suite with an installed supported CLI:

```sh
npm run test:wordcraft
```

It uses disposable public fixtures and removes its outputs by default. For independent PDF inspection,
set `WORDCRAFT_TEST_OUTPUT` to a new directory under managed scratch. An existing destination is
rejected; explicitly retained artifacts remain the caller's cleanup responsibility.
It does not download Wordcraft or claim
independent PDF/Word acceptance. The controls include `example`, a 90-row extension of
`tests/fixtures/dotm-word-corpus`, and `tests/fixtures/wordcraft/math-controls.md` (fractions, radicals,
accents, sums, integrals, a matrix and appendix TOC fields). Matrix sizes through 8x8, rectangular/nested matrices, the three-section
control and release-sensitive run/tab/equation-array controls also run in the live suite.
The normal quality gate separately checks release fixture XML for both style presets, including
direct OMML placement without synthetic wrapper elements.
The live suite also injects a stale cached TOC result, marks the TOC dirty, runs the installed
field updater and checks numbered entries, field boundaries, cleared dirty state and source preservation.
The style corpus has deliberate source-preflight violations, so exercise its raw build for
renderer comparisons rather than reporting a successful source audit.

The [17 October audit](../audits/2026-10-17-wordcraft.md) records the 0.7.0 integration.
The [0.8.0 audit](../audits/2026-10-18-wordcraft-080.md) records the upgrade comparison, independent
PDF inspection and remaining acceptance boundaries.

## Corpus provenance and PDF comparison

`scripts/quality/check_renderer_parity.py` compares a frozen corpus using an accepted Word receipt
and a Wordcraft manifest for the same source DOCX. Create a corpus JSON beside the artifacts:

```json
{
	"cases": [
		{
			"id": "public-example",
			"sourceDocx": "report.docx",
			"wordManifest": "report.acceptance.json",
			"wordcraftManifest": "report.wordcraft.json",
			"anchors": ["СОДЕРЖАНИЕ"]
		}
	]
}
```

Paths are relative to the corpus file; receipt artifact paths resolve relative to their receipt.
The checker accepts Windows paths through WSL translation when running in WSL. It requires an
accepted Word desktop receipt, stable saved/reopened pagination and verified process cleanup.
Both receipts must identify the same source hash, and recorded source/PDF paths must contain the
expected bytes. It checks PDF signatures, snapshots receipt and corpus hashes, and checks artifact
hashes again after comparison. Output cannot overwrite an input JSON, DOCX or PDF, including aliases.

Use a Python runtime with the optional pypdf, PDFium and Pillow inspection packages:

```sh
python scripts/quality/check_renderer_parity.py corpus.json --output parity.json
```

The checker reuses `compare_renderer_pdfs.py` for independent PDF page counts, geometry, normalized
text, resources, literal anchor rectangles and streamed raster comparison. Default resolution is
96 DPI with channel tolerance 16; `--dpi 72` is also supported. Results retain warnings about font
availability separately from measured page differences. Exit codes are 0 for observed equality of
all recorded checks, 1 for measured differences, and 2 for invalid provenance or unavailable comparison.
An output report may contain extracted text; keep private corpora and their reports private.

This checker neither launches Word nor grants Word acceptance. Its equality result covers the exact
frozen corpus and measurements only. Changes to TOC semantics, fonts or layout still need fresh
accepted Word receipts for their exact source DOCX before a new comparison can establish an outcome.

## Upstream evidence

- [Versioned field update implementation](https://github.com/storytold/wordcraft/blob/v0.12.0/crates/engine/src/cmd/references.rs).
- [Wordcraft known gaps](https://github.com/storytold/wordcraft/blob/v0.12.0/docs/gaps.md).
- [Layout compatibility](https://github.com/storytold/wordcraft/blob/v0.12.0/docs/layout-parity.md).

Wordcraft is MIT OR Apache-2.0; bundled assets retain their own licenses. No Wordcraft source or
binary is included in this repository. Native libraries and resources are not a guarantee of fidelity.

## 0.10.0 comparison and background Word acceptance

The [0.10.0 audit](../audits/2026-10-23-wordcraft-0100.md) separates upstream release fixes
from measured changes on frozen source documents. Known math spacing and pagination differences remain.

Use `npm run accept:word -- report.docx --background-only` when foreground Word is unwanted.
This mode makes one background attempt with a 180-second deadline and never retries interactively.
It records the selected mode and exact-process cleanup in the acceptance receipt. Failure to clean up
retains the request evidence and records `processCleanupVerified: false`.
The automatic mode retains a 45-second initial deadline for small documents and 180 seconds for
large table-heavy documents, followed by its existing interactive fallback.

`background-only` avoids foreground automation; it still uses the installed Word COM server.
No Computer Use, keyboard/mouse automation or desktop focus is needed.

## 0.11.0 acceptance

The [0.11.0 audit](../audits/2026-10-26-wordcraft-0110.md) uses matched current inputs
for both engine versions. The raw retained-control TOC defect remains; the staged-only
workaround and strict field-span checks are retained. Word PDF image modes and rejection
of nonconforming legacy table headings are explicit comparison boundaries.

The current generator accepts valid PNG decoded rows up to 128 MiB after checking exact
noninterlaced or Adam7 output size before inflation. Larger inputs fail explicitly;
images are never silently resized to satisfy this validation budget.

## 0.12.0 acceptance

The [0.12.0 audit](../audits/2026-10-28-wordcraft-0120.md) compares frozen current
inputs with both engine versions and native Word. New public controls exercise NBSP,
zero-width bookmarks and both explicit `doNotExpandShiftReturn` settings. The semantic
TOC import workaround remains necessary; no general math-leading fix is assumed.
