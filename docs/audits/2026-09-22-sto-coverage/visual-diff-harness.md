# Controlled PDF visual comparison (SUP-V07)

`scripts/quality/compare_word_pdfs.py` compares two Word-exported PDFs page by
page. It rasterizes both with Poppler `pdftoppm -gray` at the same DPI and
reports the changed pixel fraction and bounding box on each page. It rejects
different page counts, page dimensions, PDF hashes, or render contexts.

Create one manifest per PDF. The example values are placeholders:

```json
{
	"sourceSha256": "SHA256 of the identical source-content fixture",
	"pdfSha256": "SHA256 of this PDF",
	"wordVersion": "16.0",
	"wordBuild": "16.0.20326",
	"fontFingerprint": "SHA256 of a captured installed-font inventory",
	"printer": "exact printer name and driver/version",
	"dpi": 150,
	"anchors": ["page 1: title", "page 2: first table"]
}
```

The two PDFs must come from the **same source content**. Record the fixture
hash, Word version/build, installed-font inventory hash, printer/driver, DPI,
and stable text/object anchors when rendering. The script checks that these
recorded values match; the operator must independently confirm that they are
accurate. Use one approved reference export as the golden PDF and rerender the
same fixture after a generator change. Keep both PDFs and manifests together
for review. Source identity alone cannot prove equal PDF text or object
placement; inspect anchors and text if the comparison reports differences.

```sh
python scripts/quality/compare_word_pdfs.py baseline.pdf candidate.pdf \
  baseline.json candidate.json --pixel-tolerance 0 \
  --max-changed-fraction 0 --output visual-diff.json
```

Exit status 0 means the configured pixel threshold passed, 1 means it failed,
and 2 means comparison could not be performed. The defaults demand exact
pixel equality. If anti-aliasing requires a tolerance, set and record it before
reviewing the result. A passing comparison shows visual stability for that
controlled fixture and renderer; it does not prove STO or DOTM conformance.

The local unit test uses a synthetic 2×2 raster fixture and mocks Poppler. It
verifies orchestration and pixel accounting, but does not validate a real Word
export. A real SUP-V07 golden fixture still needs two matched-content Word
PDFs and a completed manifest for each. The accepted PDFs in
`.agent-work/backtest-current/` have different report content and are therefore
unsuitable as a baseline/candidate pair.
