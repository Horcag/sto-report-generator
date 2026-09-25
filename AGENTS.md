# Repository process-safety rules

## Russian report prose

- When drafting or editing connected Russian prose in report Markdown, use the bundled [`humanizer-ru`](.agents/skills/humanizer-ru/SKILL.md) skill as a required editorial pass before source preflight. Read its academic-genre exceptions and rewrite guide. Review the actual prose, make only justified edits, and inspect the diff.
- Apply this to text the agent authors or is explicitly asked to edit. For a review-only request, report findings without rewriting. Do not silently alter existing user prose during `check`, `generate`, or validation.
- Preserve claims, citations, figures, terminology, formulas, STO macros, YAML, BibTeX, and the author's voice. A style signal alone does not establish AI authorship. If the skill cannot be loaded, perform the same editorial pass using [`docs/report-authoring.md`](docs/report-authoring.md) and disclose that limitation.

- Run Word COM acceptance only through `npm run accept:word -- <docx>`. The launcher owns a hard deadline and exact-PID cleanup.
- Never start hidden or background `powershell.exe`, `WINWORD.EXE`, or Word COM diagnostics directly from an agent command.
- Any bounded diagnostic exception must have an explicit wall-clock timeout, record every Windows PID it creates, wait for completion, and verify those exact PIDs are absent before deleting scripts or artifacts or ending the task.
- A yielded terminal/session is still a live process. Always resume it to completion or terminate its exact verified PID; never treat a tool yield or a missing `WINWORD.EXE` as cleanup proof.
