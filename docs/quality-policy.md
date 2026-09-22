# Quality policy

The portable quality gate verifies source, TypeScript, Python, package, and documentation checks on GitHub-hosted runners. It does not treat GitHub-hosted Windows as proof that Microsoft Word is installed or that Word pagination is authoritative.

## Documentation links

`scripts/quality/check_markdown_links.py` checks local Markdown link targets in the root README plus `docs/` and `tests/` documentation. It deliberately does not make network requests, inspect report source Markdown, or parse fenced code examples. It accepts remote `http`, `https`, `ftp`, `mailto`, `tel`, and `data` links; those need separate availability monitoring if they become release-critical.

Run it locally with:

```powershell
uv run python scripts/quality/check_markdown_links.py --root .
```

## Native Word acceptance

`.github/workflows/native-word-acceptance.yml` runs automatically after a push to `master` and can also be started manually. Its job is constrained to a runner carrying all of these labels: `self-hosted`, `windows`, and `word`. The `word` label is an operator-maintained assertion that Microsoft Word is installed and permitted for COM automation. License state from `vnextdiag.ps1` and `OSPP.VBS` is diagnostic evidence rather than a gate; the actual capability checks decide acceptance.

The workflow builds the `example` document without a Word post-build, calls `accept-word` against the installed Word COM server, verifies its acceptance manifest, and uploads the accepted DOCX, PDF, and JSON manifest. The command first tries background automation in the current interactive Windows session and falls back to visible Word only when necessary. It keeps the user's current Windows default printer so pagination and PDF export use the same layout environment as ordinary desktop Word. The manifest proves the completed interaction mode, attempted modes, unchanged printer state, Word version, source and output hashes, valid PDF signature, installed Times New Roman font, required style checks, and stable pagination after reopening the accepted DOCX.

If Word saves and paginates the DOCX but its PDF subsystem times out, the command still fails. It preserves the partial accepted DOCX and writes a failure manifest with the completed capability checks, page count, both attempt diagnostics, the non-blocking Office license warning, and printer-restoration evidence. A partial manifest never represents an authoritative acceptance pass. A successful manifest has `status: accepted` and `execution.processCleanupVerified: true`; `pendingCleanup` is not a completed acceptance. Cleanup runs after successful attempts as well as failures, and preserves recovery receipts when process termination cannot be verified.

This is a post-merge release/acceptance signal, not a pull-request gate. Do not expose the self-hosted runner to untrusted pull-request code, do not add this job to GitHub-hosted CI, and do not infer Word availability from a `windows-latest` runner label. The Word step has a bounded timeout because Microsoft does not support unattended Office automation as a server-side workload.

## Pull-request gate

`npm run ci:check` is the portable gate used on Linux, Windows, and macOS. It checks formatting, ESLint, TypeScript, FSD boundaries, policy tests, coverage, the package contents, file sizes, local Markdown links, spelling, and the npm audit. Python formatting, Ruff, MyPy, and Python tests run immediately afterwards.

JavaScript coverage is measured against committed line, function, and branch thresholds. A narrowly scoped Windows line threshold records c8's platform-specific instrumentation result without weakening Linux or macOS. The Ubuntu report is uploaded and passed to SonarQube. Threshold changes must be reviewed as policy changes; ordinary feature work should add tests instead of lowering them.

The file-size policy blocks new source files above 500 lines and prevents known oversized files from growing. Run `npm run check:file-size -- --update-baseline` only when an oversized file was reduced or removed and the updated baseline is intentionally part of the change.

The pre-push hook runs the complete gate from an exported snapshot of the prepared Git index. Unstaged work is neither tested nor modified, so a passing hook means the exact content about to be pushed passed the gate.

GitHub Actions syntax is checked separately with pinned actionlint. `.github/actionlint.yaml` declares the intentional `word` label used by the self-hosted acceptance runner; it contains no ignored diagnostics.

## Dependency maintenance

Dependabot checks npm, Python, and GitHub Actions dependencies weekly. Security findings remain blocking engineering work even when an automated update is not available.
