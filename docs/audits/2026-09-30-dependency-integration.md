# Dependency integration: 30 September 2026

The open dependency PRs were reviewed against upstream releases and tested together rather than rejected because CI initially failed.

| PR                                                           | Decision                                             | Reason                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [42](https://github.com/Horcag/sto-report-generator/pull/42) | Merge setup-uv 10.2.0                                | Updated uv checksums and merge-queue cache handling; existing checks passed on all three operating systems.                                                                                                                   |
| [43](https://github.com/Horcag/sto-report-generator/pull/43) | Retain all five dev updates and repair compatibility | Node 26 assertion overloads reject a possibly undefined string diagnostic. A concrete fallback preserves the failure message. ESLint, Prettier, cspell and typescript-eslint updates include diagnostic and formatting fixes. |
| [44](https://github.com/Horcag/sto-report-generator/pull/44) | Integrate jsdom 30.1.1 through PR 43                 | Fixes encoding, XML serialization, focus and CSS behavior. Its Node requirements are satisfied by Node 26.                                                                                                                    |
| [45](https://github.com/Horcag/sto-report-generator/pull/45) | Integrate docx 9.7.2 through PR 43                   | Adds durable comment IDs. nanoid 6 drops old Node versions; the project runtime now satisfies its requirements. Default styles were not changed upstream.                                                                     |
| [46](https://github.com/Horcag/sto-report-generator/pull/46) | Integrate marked 18.0.14 through PR 43               | Fixes Markdown parsing, including numeric character references. The DOCX parser must consume decoded token text.                                                                                                              |

PRs 44–46 are superseded only after their exact dependency versions land through PR 43. No proposed library update is discarded or added to Dependabot ignore rules. The consolidated PR permits verification of all runtime, parser and tooling changes against one revision after the base branch changes.

## Runtime decision

Node 26.10.0 is an upstream stable release, currently on the Current line rather than LTS. Node 26 is explicitly authorized for this integration. CI, release packaging and native Word workflows use 26.x, matching @types/node 26.6.2. The package declares Node >=26.0.0 and README states the requirement. The global workstation runtime is not changed: local validation uses a task-owned Node 26.10.0 installation.

A complete quality run on Node 24.19.0 with the original dev update plus assertion fix passed before this migration. This demonstrates the initial CI failure was a typings incompatibility, not a reason to reject every update. It does not replace validation of the final Node 26 combination.

## Parser regression

A new generated-DOCX test initially failed: `&#65;`, `&#x41;` and `&#x1F600;` remained literal in document text. The handler read token.raw, bypassing marked's decoded token.text. It now uses token.text, retains named-entity handling, and leaves inline and fenced code literal. The test also verifies `&amp;#65;` is decoded only once.

## Native Word evidence

The example built with Node 26.10.0, docx 9.7.2, jsdom 30.1.1 and marked 18.0.14 passed `npm run accept:word`. The manifest reports status=accepted, stablePageCount=true, Times New Roman installed, and processCleanupVerified=true. Word exported the PDF and verified required styles. This is actual installed-Word acceptance, separate from portable XML validation.

## Known upstream warning

Node 26 warns when docx's bundled browser deprecation helper probes global localStorage without a storage file. A trace points to docx/dist/index.cjs, not the report parser. It is non-fatal and does not enable storage or change document output. No warning suppression or dependency patch is introduced.

## Upstream evidence

- [Node 26.10.0](https://github.com/nodejs/node/releases/tag/v26.10.0)
- [setup-uv 10.2.0](https://github.com/astral-sh/setup-uv/releases/tag/v10.2.0)
- [jsdom 30.1.1](https://github.com/jsdom/jsdom/releases/tag/v30.1.1)
- [docx 9.7.2](https://github.com/dolanmiu/docx/releases/tag/9.7.2)
- [nanoid 6](https://github.com/ai/nanoid/releases/tag/6.0.0)
- [marked 18.0.14](https://github.com/markedjs/marked/releases/tag/v18.0.14)
- [marked numeric entity change](https://github.com/markedjs/marked/pull/4076)
- [ESLint 10.11.0](https://github.com/eslint/eslint/releases/tag/v10.11.0)
- [Prettier 3.9.9](https://github.com/prettier/prettier/releases/tag/3.9.9)
- [cspell 10.3.4](https://github.com/streetsidesoftware/cspell/releases/tag/v10.3.4)
- [typescript-eslint 8.70.1](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.1)
