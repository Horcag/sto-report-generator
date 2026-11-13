# Validation scope

The CI workflow keeps the protected check names **Workflow lint** and
**Quality gate (ubuntu-24.04 / windows-latest / macos-latest)**.

Pull requests are compared with the merge base of their exact base and head commits.
Ordinary documentation runs once on Ubuntu. The three protected quality checks then
forward its result through short Ubuntu jobs; they do not claim to run Windows or
macOS tests. A failed scope or documentation check fails those protected checks.
For scoped pull requests, actionlint runs only when workflow files changed;
protected or unknown scopes retain the full workflow check.

Code changes run the complete existing quality gate on all three operating systems.
Pushes to `master`, `main`, `release`, and `release/**`, manual runs, and merge groups
always receive full validation. Working branches use pull-request CI, avoiding a
second matrix for the same push. Release publication and manual native Word
acceptance retain their separate workflows and checks.

## Documentation checks

The short path covers ordinary root Markdown, documentation Markdown and skill
instructions/references. It checks changed-file formatting, YAML frontmatter,
local resource links, LF, and package contents without building the example.
Changed gallery output also runs the existing gallery manifest check. Resource
renames and deletions check both paths and references from unchanged skills.

Only `docs/case-studies/*.csv` is treated as documentation data, without nested
folders. These files must be UTF-8 CSV with unique nonempty column names, consistent
record width, data records, and no invalid control characters. Columns ending in
`_url`, `_link`, or `_path` additionally require valid external URLs or existing
local targets. Internal measurement identifiers are not interpreted by this check.
Other CSV files remain on the full path.

Markdown under runtime, test, example, template, or profile inputs receives full
validation. This includes skill example/fixture/template directories. Report metadata
and unfenced STO commands also identify report sources at otherwise ordinary
Markdown paths. Fenced instructional examples do not turn an ordinary skill document
into an executable report input. Policy files such as `AGENTS.md`, dependencies,
lock files, workflows, mixed changes and unknown paths receive full validation.
Missing revisions, unavailable history, malformed change records, an empty diff, or
incomplete classification evidence select the full path rather than passing silently.

## Local pre-push

The hook uses the same classifier. It exports the actual pushed commit into a
removed-after-use snapshot, so unrelated staged or working-tree edits cannot change
what was tested. Documentation uses installed formatting tools without a fresh
dependency install or the code suite. Code and protected branch/release pushes retain
LF validation of the exported commit, fresh dependency installation, and `npm run quality`. If push revisions are absent,
the prepared index is checked with the full gate.

The package-content-only mode is `npm run check:pack -- --content-only`.
The normal `check:pack` command still builds and audits the portable example.
