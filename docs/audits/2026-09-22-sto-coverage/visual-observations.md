# Historical visual observations

The local qualification-work example was reviewed on all 23 PDF pages during the
2026-09-22 audit. This journal preserves layout observations without publishing
personal content, source pages or images. It is evidence about that example,
not proof of the generator's visual equivalence or a universal report structure.

| PDF page | Observed construct                                                                                          | Evidence boundary                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1        | Centered title with multiple blocks and signatures; no printed page number                                  | The specific form is profile-dependent                                           |
| 2–3      | Assignment form, approval and signatures; instruction for printing the assignment on both sides             | Does not require double-sided printing for the rest of the report                |
| 4        | Centered uppercase referat heading, actual document counts, uppercase keywords                              | Presentation metadata is sample-specific; counts do not prove generator behavior |
| 5        | Centered uppercase contents heading, dot leaders, right-aligned page numbers, appendix subheadings included | Does not prove automatic field updates in a new DOCX                             |
| 6–8      | Body text, introduction and numbered section; reference precedes figure                                     | Does not establish semantics or exact image scaling                              |
| 9–14     | Intermediate sections and objects were included in the visual pass                                          | No independent matched-content generator comparison was performed                |
| 15       | References precede tables, captions appear above tables                                                     | Tables fit their pages; no continuation-table example                            |
| 16–17    | Figures with captions below; reference before the object                                                    | Does not prove Word anchor or page-break behavior                                |
| 18       | Conclusion with centered uppercase structural heading                                                       | Bold styling needs a decision on source precedence                               |
| 19       | Source list starts on a new page; numbered entries                                                          | Visual review is not full bibliographic compliance checking                      |
| 20–21    | Appendix A, title, figure A.1 and table A.1; references before objects                                      | Does not prove generator support for local numbering                             |
| 22–23    | Appendix B with B.1/B.2 subheadings and compact monospaced code                                             | Code is a distinct construct, not ordinary body typography                       |

All pages have a PDF MediaBox of 595.32 × 841.92 points and rotation zero.
Observed body text begins near x=85.1 points (30 mm); rightmost text extends
near x=552.9 points (15 mm from the edge). Selected headings begin near
y=57.1 points (20.1 mm from the top). Page numbers appear at the bottom
center. These are sample measurements, not tolerance thresholds.

The sample includes editorial fragment-end marks. They are instructions in an
example, not content to insert into generated reports. Its contents entries
use sentence case without terminal dots while the contents heading uses
uppercase. Sources precede appendices in that sample.

The audit also inspected the three formula-rule pages and the marker/case/
punctuation tables on list-rule pages 11–13. Formula typography depends on
symbol meaning; list punctuation depends on marker, syntax and item complexity.
The final item has its own termination rule. See [special-atoms.csv](special-atoms.csv).

A separate generated eight-page document was accepted by Word. Its page 2
still displayed unresolved counters; page 8 showed a Times New Roman number
and text with an Arial space between them. Measured number/text positions were
120.50/141.74 points, with continuation text at 85.104 points. This is an
observed comparison item, not a demonstrated normative spacing defect.

Future verification needs equal content in the reference template and generator,
then comparisons of text boundaries, baselines, numbers, captions and tables in
the same Word environment. Different content cannot establish pixel parity.
