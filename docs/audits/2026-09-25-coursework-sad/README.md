# Coursework SAD: source and formula audit

This directory records the exact report sources changed for this work. The
working `reports/` directory is a separate local Git repository without a
remote and is ignored by the generator repository. Only the four files under
[`audit-sources/coursework_sad/`](../../../audit-sources/coursework_sad/)
are delivered; other report files and their dirty working state remain outside
this commit. The copied files have byte-identical SHA-256 hashes to their local
counterparts at the time of the audit.

The fourth file, `30_results.md`, is needed to keep the Brown–Forsythe null
hypothesis in the results consistent with the corrected definition in the
methodology.

## Source warnings and the primary STO

The primary source is `STO_SGAU_02068410-004-2018`, sections 5.3 and 6.2,
held locally in `reports/practice_ppb_2026/source_materials/`. Section 5.3
requires the referat to cover the object, purpose, results, characteristics,
and application; it **recommends** no more than 850 characters for its text.
Section 6.2 requires a numbered continuation caption **when a table is
continued on another page**. It specifies no row count at which a source table
must be divided.

| Previous warning                       | Classification                                                                 | Resolution                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `04_data_description.md:26`, 14 rows   | Row-count heuristic, false positive for this document                          | Table 2 fits on PDF page 12; removed the heuristic                                      |
| `04_data_description.md:49`, 13 rows   | Row-count heuristic, false positive for this document                          | Table 3 fits on PDF page 13; removed the heuristic                                      |
| `30_results.md:9`, 13 rows             | Row-count heuristic, false positive for this document                          | Table 7 fits on PDF page 37; removed the heuristic                                      |
| Missing `\sto_referat_characteristics` | Semantic coverage required by section 5.3; the macro is a generator convention | Added a concise characteristics paragraph                                               |
| Missing `\sto_referat_application`     | Semantic coverage required by section 5.3; the macro is a generator convention | Added the application paragraph                                                         |
| Referat longer than 850 characters     | Recommendation, measured by a faulty source-wide heuristic                     | Count only rendered referat text after the keyword list; revised text is 827 characters |

`npm run check:source -- reports/coursework_sad` passes with zero warnings.
The three table page positions refer to the previously accepted 67-page Word
PDF; they are evidence about those tables, not a general row-count rule.

## Formula inventory

[`formulas.json`](formulas.json) lists each of the 179 source math occurrences
(39 display and 140 inline), with file, line, column, exact TeX and limited
context. It records 141 distinct expressions and SHA-256 hashes of the source
files. [`formulas.html`](formulas.html) starts a three-part catalog of locally
rendered SVGs for the distinct expressions, with links to delivered source
where available. The
eight `display-contact-*.png` sheets provide an overview of display equations.
The inventory is a source-render audit; Word/PDF acceptance is a separate
check. A fresh DOCX after the hypothesis correction contains 179 OMML
expressions, no `<undefined>` nodes or visible placeholder glyphs, and passes
all 51 generated-DOCX validation checks. Native Word did not open the fresh
input, and its guarded launcher refused process cleanup because it detected
unexpected Word windows. This audit therefore makes no fresh Word/PDF
acceptance claim. The earlier 67-page `final4` PDF was accepted before the
last source changes and is used only for the table page observations above.
