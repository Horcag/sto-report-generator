# Quality policy

The portable quality gate verifies source, TypeScript, Python, package, and documentation checks on GitHub-hosted runners. It does not treat GitHub-hosted Windows as proof that Microsoft Word is installed or that Word pagination is authoritative.

## Documentation links

`scripts/quality/check_markdown_links.py` checks local Markdown link targets in the root README plus `docs/` and `tests/` documentation. It deliberately does not make network requests, inspect report source Markdown, or parse fenced code examples. It accepts remote `http`, `https`, `ftp`, `mailto`, `tel`, and `data` links; those need separate availability monitoring if they become release-critical.

Run it locally with:

```powershell
uv run python scripts/quality/check_markdown_links.py --root .
```

## Native Word acceptance

`.github/workflows/native-word-acceptance.yml` runs automatically after a push to `master` and can also be started manually. Its job is constrained to a runner carrying all of these labels: `self-hosted`, `windows`, and `word`. The `word` label is an operator-maintained assertion that Microsoft Word is installed and permitted for COM automation; before starting COM, the workflow checks supported Microsoft 365 Apps and Office products that contain Word through `vnextdiag.ps1` for vNext/device licensing and `OSPP.VBS` for legacy/volume licensing.

The workflow builds the `example` document without a Word post-build, calls `accept-word` against the installed Word COM server, verifies its acceptance manifest, and uploads the accepted DOCX, PDF, JSON manifest, and stage diagnostics. The manifest proves the Word version, source and output hashes, installed Times New Roman font, required style checks, and stable pagination after reopening the accepted DOCX. The diagnostics receipt is written before every blocking COM stage; a stage timeout triggers addressable cleanup of only the runner and Word automation process owned by that acceptance run.

This is a post-merge release/acceptance signal, not a pull-request gate. Do not expose the self-hosted runner to untrusted pull-request code, do not add this job to GitHub-hosted CI, and do not infer Word availability from a `windows-latest` runner label. The Word step has a bounded timeout because Microsoft does not support unattended Office automation as a server-side workload.

## Pull-request gate

`npm run ci:check` is the portable gate used on Linux, Windows, and macOS. It checks formatting, ESLint, TypeScript, FSD boundaries, policy tests, coverage, the package contents, file sizes, local Markdown links, spelling, and the npm audit. Python formatting, Ruff, MyPy, and Python tests run immediately afterwards.

JavaScript coverage is measured against committed line, function, and branch thresholds. A narrowly scoped Windows line threshold records c8's platform-specific instrumentation result without weakening Linux or macOS. The Ubuntu report is uploaded and passed to SonarQube. Threshold changes must be reviewed as policy changes; ordinary feature work should add tests instead of lowering them.

The file-size policy blocks new source files above 500 lines and prevents known oversized files from growing. Run `npm run check:file-size -- --update-baseline` only when an oversized file was reduced or removed and the updated baseline is intentionally part of the change.

The pre-push hook runs the complete gate from an exported snapshot of the prepared Git index. Unstaged work is neither tested nor modified, so a passing hook means the exact content about to be pushed passed the gate.

GitHub Actions syntax is checked separately with pinned actionlint. `.github/actionlint.yaml` declares the intentional `word` label used by the self-hosted acceptance runner; it contains no ignored diagnostics.

## Dependency maintenance

Dependabot checks npm, Python, and GitHub Actions dependencies weekly. Security findings remain blocking engineering work even when an automated update is not available.
