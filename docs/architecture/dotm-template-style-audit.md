# Canonical DOTM style transfer

The default `samara-template-2022` preset uses the style definitions extracted from `tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm`. The fixture SHA-256 is `a8a06c6e9c273149b0ba8629e2552b4fce563916921391dcb51027dc8175b261`. No VBA, template macros, external relationships or user document content are imported.

The [teaching matrix](../audits/2026-10-25-style-teaching.md) records the author's style recommendations and demonstrations. The [table evidence](../audits/2026-10-25-table-sources.md) distinguishes the applicable standard editions from local examples and preferences.

## Definition identity and relationships

The canonical package contains 79 styles: 48 paragraph, 27 character, two table and two numbering definitions. This is not 79 paragraph roles. The versioned [source XML data](../../src/shared/config/samara-template-2022-styles.json) is independently compared with the original fixture in [the application test](../../tests/validator/template_style_application_test.ts).

[ID mapping and import](../../src/shared/config/sto-template-styles.ts) retains one definition per native display name. Source IDs with existing generator roles are remapped once; `basedOn`, `next` and linked-character references use the same mapping. The [contract](../../tests/fixtures/validator/etalon/dotm-style-contract.json) records every source ID and its generated counterpart. Unused built-ins and character/table styles remain available to Word; they are not assigned indiscriminately to body text.

The source package's numbering IDs cannot be copied as references to absent numbering instances. Supported headings and bibliography use portable numbering. Legacy heading levels 7–9 and the old numbering style remain available without an active package-local numbering binding. The generator's public heading syntax supports levels 1–6. This is a declared adaptation rather than a claim that every source behavior is unchanged.

The `default` preset retains portable generator styles without importing the full template inventory. The default selected preset remains `samara-template-2022`.

## Actual style assignments

| Element                         | Assigned paragraph style                                      | Word display / origin                                                                                |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Main prose                      | `Normal`                                                      | Canonical first-line-indented body style                                                             |
| Numbered sections 1–4           | `StoHeading1`–`StoHeading4`                                   | Canonical numbered heading names                                                                     |
| Numbered sections 5–6           | `StoHeading5`–`StoHeading6`                                   | Native built-in names, adapted to the portable black report typography                               |
| Unnumbered structural heading   | `StructuralHeading`                                           | Canonical centered uppercase structural style                                                        |
| Abstract and contents headings  | `StructuralHeadingNoTOC`                                      | Canonical style excluded from the TOC                                                                |
| Abstract keywords               | `ReferatKeywords`                                             | Canonical keyword style                                                                              |
| Automatic TOC entries           | `TOC1`–`TOC4`, Word entry aliases                             | Canonical TOC roles                                                                                  |
| Appendix label and title        | `AppendixHeading`                                             | One paragraph, with soft line breaks, using the canonical appendix style                             |
| Appendix subsection             | `AppendixSectionHeading`                                      | Canonical appendix subdivision role                                                                  |
| Table caption                   | `TableCaption`                                                | Canonical table-caption style                                                                        |
| Left-aligned table data         | `TableText`                                                   | Canonical table-text style                                                                           |
| Center/right table cells        | `TableTextCenter`, `TableTextRight`                           | Explicit derived alignment styles; the template has only the base table-text definition              |
| Table notes                     | `TableNote`                                                   | Derived final-note role, based on table text                                                         |
| Prose immediately after a table | `TableFollowingText` when the original role is ordinary prose | Derived paragraph role with the chosen 6 pt before interval; headings retain their own role          |
| Figure image paragraph          | `Figure`                                                      | Derived centered role with no first-line indent; the lecturer did not define a dedicated image style |
| Figure caption                  | `FigureCaption`                                               | Canonical figure-caption style                                                                       |
| Bibliographic entry             | `Bibliography`                                                | Canonical bibliography role with portable automatic numbering                                        |
| List item                       | `ListParagraph`                                               | Native list paragraph role with the generator's list numbering                                       |
| Formula paragraph               | `Formula`                                                     | Canonical equation-style identity adapted to the existing portable math-table layout                 |
| Title institutional block       | `TitlePageText`                                               | Canonical centered title-page role                                                                   |
| VKR topic                       | `TitlePageTopic`                                              | Canonical topic style; other title profiles keep their established title layout                      |
| Footer/page number              | `a8` paragraph / `aa` character in the template preset        | Canonical footer and page-number roles                                                               |

The source's automatically displayed variants, such as a base table-text style followed by an alignment modifier, are not separate canonical style definitions. The generator makes those recurring roles explicit with derived named styles. These additions and their source-derived roles are tested separately from the immutable 79-style inventory.

## Verification and limits

The contract and application suites verify the exact source inventory, generated names/types, remapped dependencies, numbering references and actual role assignments. Table, parser, TOC and title-page tests exercise the corresponding content paths. Snapshot changes must show real semantic assignments rather than merely a new style catalog.

These checks do not establish pixel identity to every original template page. The report retains deliberate typography, section geometry, supported formula layout and portable numbering adaptations. Final Word acceptance separately verifies the saved artifact and pagination; available styles and applied styles are distinct observations.
