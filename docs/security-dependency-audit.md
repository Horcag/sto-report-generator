# Dependency Security Audit

<!-- cspell:words picomatch extglobs steiger -->

Date: 2026-11-18

## Result

`npm audit --omit=dev --audit-level=low` reports zero known vulnerabilities in production
runtime dependencies for the committed lockfile.

`npm run security:audit` (`scripts/quality/check_security_audit.cjs`) runs both:

- `npm audit --omit=dev --audit-level=low --json` with zero tolerance for any production
  advisory; and
- a full lockfile `npm audit --audit-level=low --json` check that fails on any other
  advisory or as soon as a non-breaking patch ships for `picomatch`, while temporarily
  waiving the single upstream-unpatched dev-only ReDoS advisory
  `https://github.com/advisories/GHSA-fc5q-39xc-vjpf` (`picomatch <=4.0.7`,
  `first_patched_version: null`, pulled transitively only by dev tools `cspell`,
  `steiger`, and `typescript-eslint` on static repository globs).

## Remediated dependencies

| Package           | Resolved version | Reason                                                                                         |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `adm-zip`         | `0.6.1`          | Fixes uncontrolled ZIP memory allocation and symlink extraction advisories.                    |
| `image-size`      | `2.0.4`          | Fixes infinite-loop advisories for ICNS, JXL and HEIF parsing.                                 |
| `form-data`       | removed          | Upgrading `jsdom` to `30.1.0` removed the vulnerable multipart dependency from the tree.       |
| `js-yaml`         | `3.15.2`         | Keeps `gray-matter` API compatibility while fixing merge-key denial-of-service advisories.     |
| `nanoid`          | `5.1.16`         | Fixes non-secure generator loop and integer-overflow advisories used through `docx`.           |
| `brace-expansion` | `5.0.12`         | Fixes exponential and unbounded expansion denial-of-service advisories in development tooling. |
| `postcss`         | `8.5.28`         | Fixes source-map path traversal in development tooling.                                        |
| `esbuild`         | `0.28.2`         | Fixes the Windows development-server arbitrary file-read advisory.                             |

Direct consumers were regression-tested after updating `adm-zip`, `image-size`, `docx`, `jsdom` and `tsx`.

## Packaging controls

The package remains private and source-only. `package.json` uses an explicit `files` allowlist, and
`npm run check:pack` rejects local runtime, agent, workflow, test, fixture, report or generated artifact paths.
