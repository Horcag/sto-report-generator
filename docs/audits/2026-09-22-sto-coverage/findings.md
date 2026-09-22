<!-- cspell:words twips -->

# Historical findings and evidence boundary

This report preserves the conclusions that are useful for maintainers without
publishing the local academic corpus or its generated artifacts. It describes
revision `09b079fef3b037f79b33cc486f96133c6efca044`; the repository may now
contain later changes.

## Coverage interpretation

The original inventory contained 401 rows, with intentional overlap between
the base STO material, formatting-specialist material, and profile/form
material. `coverage-status-matrix.csv` aggregates every row by area. Its
`other_qualified_statuses` column contains findings such as source conflict,
verified sample, reproduced defect, configuration choice, pipeline gap, and
out-of-scope. It is not safe to treat `implemented / 401` as a compliance
metric.

The source corpus is local-only. Each matrix row was classified from an
audited source type (standard, methodical material, template, form, or code)
and linked either to repository code/tests or to withheld local evidence.
`source-identities.csv` preserves standard designations and generic material
identities; `source-coverage.csv` provides the audited source inventory. The
public package excludes source text, private paths, sample identities,
source-template files, rendered pages, Word/PDF outputs, and
learning-platform links.

## Confirmed defects and gaps

1. `validateSTO` checked styles but not all effective direct paragraph
   properties. The historical probe mutated left/right and first-line indents
   plus spacing properties. All ten mutated documents passed the same 40
   checks as the baseline. See `validator-probes.json` and the reproducible
   probe.
2. The code-block roundtrip changed literal data and inserted a zero-width
   space. Style conformance is insufficient for code; tests should compare the
   logical code text and whitespace exactly.
3. A historical Word-acceptance run left referat placeholders unresolved.
   Counter completion happened on a different post-build route. The result is
   a route-consistency gap, not evidence that every supported route fails.
4. Appendices do not yet have complete semantic modelling for title form,
   letter assignment, local numbering, table-of-contents entries, and
   reference order.
5. Logical first mention/order of figures, tables, and references, notes,
   definitions/acronyms, numeric precision, and complex rendered layouts need
   structural models or manual/Word evidence beyond source heuristics.
6. Formula conversion warnings did not necessarily fail generation in the
   examined samples. Formula failure semantics need an explicit contract.

## Template comparison

The historical template lane inventoried 79 styles, mapped 17 to portable
generator styles, measured 122 numeric comparisons, and recorded 185 raw
property differences. `dotm-numeric-deltas.csv` contains the measurement
values, units, and a sanitized basis explanation. `dotm-property-deltas.csv`
retains all 185 property-level changes with its sanitized basis explanation;
raw XML payloads and private template locations are omitted.

Numerically equal values do not establish visual or normative equivalence:
the generator may serialize explicit defaults while a template inherits a
value. Conversely, a difference can be an intentional portable adaptation.
The historical basis explains each difference; `unidentified` means the audit did not find an authoritative basis
for that exact difference.

## What a future audit must do

Use the reproduction probes as diagnostic starting points, then verify the
current revision with targeted tests and fresh Word/layout acceptance. A full
claim would require a shared-content reference corpus, direct and inherited
property checks, and rendered comparisons for long tables, complex formulas,
TOC levels, captions, bibliography variants, and optional profile structures.

## Units and visual evidence

With `lineRule=auto`, a line value of 360 means 1.5 lines, not 360 twips.
Paragraph indents and before/after spacing use twips (1/20 point); font size
and run position use half-points. Numbering properties are a separate layer.
The computed XML cascade is not the full effective Word layout: direct
formatting, toggle properties and conditional table styles still matter.

The historical audit visually reviewed all 23 pages of the qualification-work
example. A separate generated example passed native Word opening, field
updates, PDF export and reopening with a stable eight-page count. The local
receipt recorded verified process cleanup. These observations do not prove
identical layout across all constructs. The original pages and receipts remain
local-only; the public probes reproduce only the portable findings.

A matched-content Word corpus is still needed before claiming millimeter-level
parity. Full atomization of every subclause of all external standards is also
unfinished; the matrix records supported types and explicit gaps.
