# Experimental Wordcraft PDF renderer

Wordcraft is an optional local renderer. The TypeScript generator remains the owner of DOCX structure,
STO styles, bibliography and OMML. Wordcraft does not replace the Markdown parser, XML validator or
the separate Microsoft Word acceptance command.

## Runtime contract

- Supported CLI: **0.8.0**, release commit `f2e15cf8f899a79899a2d9595ca4ce7df1e5ea22`.
- Install `wordcraft-cli` from its [official release](https://github.com/storytold/wordcraft/releases/tag/v0.8.0).
  Use `PATH`, `WORDCRAFT_CLI`, or the `--wordcraft` argument. Nothing is downloaded at render time.
- Run `uv sync` in the generator installation directory. The renderer executes that directory's
  `.venv` Python directly; the helper uses the existing XML/statistics package and never invokes COM.
- Select `--renderer wordcraft` for `generate`, `audit` or `preview`. The existing portable default
  and LibreOffice preview default remain available. Word COM post-build cannot be combined with Wordcraft.
- The default outputs are `report.wordcraft.pdf` and `report.wordcraft.json`. A `--pdf` override derives
  its JSON path from the chosen PDF basename. Rendering never writes back to the source DOCX.

## Render sequence

1. Check executable version and output destinations.
2. Create a temporary directory beside the output, preserving the original DOCX hash.
3. Rebuild a temporary copy from the original for each iteration. Fill statistic placeholders with
   the existing count/pluralization rules, including placeholders split across XML runs.
4. Run `references.updateFields` explicitly. A plain Wordcraft `convert` does not update the TOC.
5. Reopen the updated copy with `info`, export PDF, then reopen it again to compare layout counts.
6. Repeat with the measured page total, for at most three iterations, until the inserted total agrees.
7. Check the PDF signature and source hash, publish the PDF and JSON, and remove staging on success or failure.

One 120-second budget covers version lookup, preparation, field updates and exports. Individual
CLI calls are synchronous, use argument arrays without a shell, and are terminated on timeout.
Existing PDF/JSON outputs survive a failed conversion. This is a bounded synchronous launcher;
it does not start the desktop app or an MCP server.

The manifest records `experimental: true`, `wordAccepted: false`, source/PDF SHA-256 hashes,
the CLI version, warnings and the final layout count. `pageCountSource: "wordcraft-info"` and
`pdfPageCountVerified: false` distinguish the engine's own report from an independent PDF inspection.
Before/after `info` is a stability check on the staged DOCX; it is not a PDF parser.

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
accents, sums, integrals, a matrix and appendix TOC fields).
The live suite also injects a stale cached TOC result, marks the TOC dirty, runs the installed
field updater and checks numbered entries, field boundaries, cleared dirty state and source preservation.
The style corpus has deliberate source-preflight violations, so exercise its raw build for
renderer comparisons rather than reporting a successful source audit.

The [17 October audit](../audits/2026-10-17-wordcraft.md) records the 0.7.0 integration.
The [0.8.0 audit](../audits/2026-10-18-wordcraft-080.md) records the upgrade comparison, independent
PDF inspection and remaining acceptance boundaries.

## Upstream evidence

- [Versioned field update implementation](https://github.com/storytold/wordcraft/blob/v0.8.0/crates/engine/src/cmd/references.rs).
- [Wordcraft known gaps](https://github.com/storytold/wordcraft/blob/v0.8.0/docs/gaps.md).
- [Layout compatibility](https://github.com/storytold/wordcraft/blob/v0.8.0/docs/layout-parity.md).

Wordcraft is MIT OR Apache-2.0; bundled assets retain their own licenses. No Wordcraft source or
binary is included in this repository. Native libraries and resources are not a guarantee of fidelity.
