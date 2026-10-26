# Repository process-safety rules

## Bibliography

- Before changing bibliography metadata or formatting, read `docs/bibliography-workflow.md` and its coverage matrix. Source-list descriptions, citations in the text, and bibliographic references follow distinct rules.
- Verify the source type, version, authors and supplied description fields against the original publication or repository record. Store field-level evidence in the report's private `bibliography-evidence.json`; do not infer missing dates, publishers, places or identifiers.
- New reports require evidence by default. For an existing report, set `bibliographyEvidence: required` when bringing its bibliography into this workflow. Run `audit:bibliography -- <report> --require-evidence`, source preflight and DOCX validation. Inspect the final bibliography after Word acceptance. Keep recordings, transcripts and personal audit evidence outside public Git.

## Russian report prose

- When drafting or editing connected Russian prose in report Markdown, use the bundled [`humanizer-ru`](.agents/skills/humanizer-ru/SKILL.md) skill as a required editorial pass before source preflight. Read its academic-genre exceptions and rewrite guide. Review the actual prose, make only justified edits, and inspect the diff.
- Apply this to text the agent authors or is explicitly asked to edit. For a review-only request, report findings without rewriting. Do not silently alter existing user prose during `check`, `generate`, or validation.
- Preserve claims, citations, figures, terminology, formulas, STO macros, YAML, BibTeX, and the author's voice. A style signal alone does not establish AI authorship. If the skill cannot be loaded, perform the same editorial pass using [`docs/report-authoring.md`](docs/report-authoring.md) and disclose that limitation.

- Run Word COM acceptance only through `npm run accept:word -- <docx>`. The launcher owns a hard deadline and exact-PID cleanup.
- Never start hidden or background `powershell.exe`, `WINWORD.EXE`, or Word COM diagnostics directly from an agent command.
- Any bounded diagnostic exception must have an explicit wall-clock timeout, record every Windows PID it creates, wait for completion, and verify those exact PIDs are absent before deleting scripts or artifacts or ending the task.
- A yielded terminal/session is still a live process. Always resume it to completion or terminate its exact verified PID; never treat a tool yield or a missing `WINWORD.EXE` as cleanup proof.

## Releases

- Follow `docs/releases.md`: select SemVer deliberately, update `package.json`, both root lockfile
  versions and `CHANGELOG.md` together. Keep README installation examples current.
- Use merged pull requests as the source for automatic release notes; label them using
  `.github/release.yml`. Keep private evidence and operator details out of release notes.
- Validate metadata with `node scripts/quality/check_release_version.cjs` and its Node test suite,
  then run the LF check and full quality gate before tagging the verified primary-branch commit.
- Publish stable `vMAJOR.MINOR.PATCH` tags only. The Release workflow validates, packs and publishes
  the GitHub Release asset; manual workflow runs validate without publishing. Verify the remote
  release and exact package version before reporting publication. npm registry publication is separate.
- Update `ROADMAP.md` when scope changes; distinguish planned work from shipped, verified behavior.
