# Formula conversion repair (2026-09-30)

This historical audit used an anonymized coursework corpus with 179 formula occurrences:
39 display equations and 140 inline equations. Source documents and comparison artifacts remained
private. The observations describe the revisions tested on 30 September 2026; they do not establish
acceptance of later changes or the Wordcraft integration.

## Reproduced defects and fixes

The raw TypeScript build changed a fractional outer exponent `3/2` into `J` in one equation
(occurrence 113). The OMML adapter searched descendants for structural slots, so a nested exponent
could be selected instead of its parent's exponent. Fractions and indexed radicals had the same
failure mode. Structural slots were changed to use immediate children; radical degrees retained
all their children. Valid n-ary operators outside the adapter's sum/integral builders retained their
original OMML rather than disappearing.

Python formula replacement already retained that exponent but lost explicit `\quad` spacing in ten
equations. The repair preserved `\quad` and `\qquad`. An initial Word experiment also showed a long
equation on page 22 wrapping before `>` without repeating the sign. The corrected rendering repeated
the relation sign on the following line. Preserving page geometry alone did not establish correct
formula layout.

The builder set `m:mathPr/m:brkBin` to `repeat` and `m:brkBinSub` to `--`, using Word's native handling
of operator repetition throughout the document. Its meaning and default behavior are documented by
[Microsoft](https://learn.microsoft.com/en-au/dotnet/api/documentformat.openxml.math.breakbinary?view=openxml-3.0.1).
Both paths retained non-breaking spaces inside `\text{...}` when normalizing MathML. Python also
rejected MathJax error output before replacing any formula, so malformed TeX left the original DOCX
untouched.

Regression tests covered nested fractions, nested scripts, indexed and ordinary radicals, the
fractional outer exponent, unsupported/default n-ary operators, repeated spacing, text spaces,
generated Word math settings and atomic failure on malformed input.

## Historical document preservation checks

The same sources were built before and after the repair. Each build contained 179 OMML equations.
After replacing each equation with an indexed placeholder, the canonical document XML was identical.
Other ZIP parts were identical except creation/modification timestamps in `docProps/core.xml` and
the new math operator repetition settings in `word/settings.xml`.

The raw build differed in six equations: the outer exponent and missing text spaces in five equations.
Python replacement differed in ten equations, restoring explicit spacing while preserving their
mathematical structure. Original source/output SHA-256 checks passed. No equation table layout or
document styles were changed in that comparison.

## Historical native Word result

The tested coursework passed the bounded Word launcher on Word 16.0 build 16.0.20326, using the same
printer as the baseline. It reopened at a stable 66 pages, exported a PDF and verified process cleanup.
Input, accepted DOCX and PDF hashes matched the acceptance manifest.

Rendering both complete PDFs at 144 DPI produced 60 identical pages. Pages 20, 22, 24, 27, 29 and 39
differed at the ten equations with restored spacing. Each changed page was inspected. Page 22 ended
the first equation line with `>` and started the second with `>`; operator repetition was visible in
Word's PDF. Subsequent text on that page moved down by one equation line; the page count and content
were preserved. Other changed pages showed spacing differences without additional wraps or clipping.
The comparison used the same live Word and printer; a complete font fingerprint was not captured.

The raw TypeScript repair was also rendered in Word before the repetition setting was added.
The original report source and output hashes remained unchanged. These dated observations remain
separate from current automated checks and later native acceptance runs.

## Direction for further work

Keep editable OMML and let Word lay it out. A language migration does not fix incorrect structural
traversal or dropped spacing. Extend semantic regression fixtures when a new construct fails, then
compare the complete document in Word through `npm run accept:word -- <docx>`. Retain both the raw
build and Python replacement in testing because they use different OMML serialization paths.

Native Word rendering remains a separate gate from XML correctness. This case does not establish
exact rendering for arbitrary LaTeX or every Word version. Current changes require their own quality
checks and, where applicable, native acceptance evidence.
