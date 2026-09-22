# STO coverage audit (public summary)

This directory publishes a curated, portable summary of a historical audit
performed on 22 September 2026 against generator revision
`09b079fef3b037f79b33cc486f96133c6efca044`. It is deliberately not an
assertion of full STO compliance.

The audit mapped 401 overlapping requirement rows: 219 STO rows, 129
formula/list/bibliography rows, and 53 applicability/form/template rows. The
row count is a traceability inventory, not a percentage: several source
materials cover the same requirement. See [coverage-summary.json](coverage-summary.json)
and [full-matrix.csv](full-matrix.csv).

The original audit also compared 79 template styles. It recorded 122 numeric
comparisons across 17 mapped styles and 185 raw property differences. The
published numeric matrix keeps measured values and a sanitized basis explanation;
it omits private source-template locations and raw source documents. See
[dotm-numeric-deltas.csv](dotm-numeric-deltas.csv), the full property matrix
[dotm-property-deltas.csv](dotm-property-deltas.csv), and the 79-style
classification [dotm-styles.csv](dotm-styles.csv).

## Confirmed findings

- Direct paragraph formatting can evade the style-oriented validator: the
  baseline and ten deliberately malformed body paragraphs each returned 40
  passing checks. The reproduced outcomes are in
  [validator-probes.json](validator-probes.json).
- A code block did not preserve its input text character-for-character: an
  escaped ampersand changed and a zero-width space was inserted. See
  [code-probe.json](code-probe.json).
- The Word-acceptance route observed unresolved referat counters in one
  historical accepted PDF. The report treats this as a pipeline gap, not proof
  that every build route has the same behavior.
- Appendix semantics, direct-formatting validation, semantic reference order,
  complex placement/layout checks, notes, and several bibliography variants
  remain incomplete or require manual evidence.

## Reproduction boundary

`probes/probe-validator.ts` and `probes/probe-code.ts` are portable diagnostic
scripts. They write only to `.agent-work/published-sto-audit/`, recreate their
inputs on every run, and report observations; they are not product tests or
new acceptance expectations.

Run them from the repository root:

```sh
npx tsx docs/audits/2026-09-22-sto-coverage/probes/probe-validator.ts
npx tsx docs/audits/2026-09-22-sto-coverage/probes/probe-code.ts
```

The local evidence corpus, private learning-platform materials, raw extracted
text, source templates, images, generated DOCX/PDF files, and original
machine-specific acceptance receipts are not reproduced here. In the matrix,
`local-only` means that the historical evidence was deliberately withheld;
repository-relative references identify code that can be inspected in this
repository. A later audit must rerun the probes and perform Word/layout
acceptance for its own environment.

[source-identities.csv](source-identities.csv) preserves standard
designations and generic local-material identities while removing private
paths and sample identities. [source-coverage.csv](source-coverage.csv)
records their audited coverage depth without publishing the source files.

## Current probe reproduction

On 22 September 2026, the two published probes were rerun successfully at
repository revision `daa76c940ea4672e54695a91bd5b1bbb604a224c`. The validator
again returned 40 passing checks for the baseline and all ten mutations; the
code probe again reported `codeTextPreserved: false` and a zero-width space.
This confirms those observations on that revision only. The historical
source/layout corpus and Word-acceptance evidence remain tied to the earlier
audited revision.

## Optional NIR structures

NIR forms, plans, reviews, statements, and titles are optional document
structures selected by the assignment/profile. Their presence in the local
historical corpus does not make them mandatory for every report. The generic
engine should validate the structures that are present instead of adding NIR
sections to unrelated reports.

## Follow-up work

See the [prioritized implementation backlog](backlog.md). Publishing this audit does not close those implementation tasks.

The [visual observation journal](visual-observations.md) preserves page-level findings and geometric measurements without the source images.
