"""Exercise real documentation tools in a prepared snapshot without node_modules."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.quality.run_clean_index_quality import export_snapshot


class IsolatedDocumentationTests(unittest.TestCase):
    def test_real_snapshot_policy_csv_links_and_package_without_install(self):
        repository = Path(__file__).resolve().parents[2]
        # A pre-push snapshot has an index but need not have a HEAD commit.
        tree = subprocess.check_output(["git", "write-tree"], cwd=repository).decode().strip()
        with tempfile.TemporaryDirectory(prefix="sto-docs-isolated-") as temporary:
            snapshot = Path(temporary) / "snapshot"
            snapshot.mkdir()
            export_snapshot(repository, snapshot, "git", tree)
            checker = Path("scripts/quality/check_documentation.py")
            # Also exercise the working implementation before its first commit.
            (snapshot / checker).write_bytes((repository / checker).read_bytes())
            policy = json.loads((snapshot / ".prettierrc").read_text(encoding="utf-8"))
            self.assertIn("@ianvs/prettier-plugin-sort-imports", policy["plugins"])
            policy["plugins"].append("./must-not-load-code-plugin.cjs")
            policy.update({"proseWrap": "always", "printWidth": 40})
            (snapshot / ".prettierrc").write_text(
                json.dumps(policy),
                encoding="utf-8",
                newline="\n",
            )
            names = [
                ".agents/skills/sto-report-generator/references/isolated-smoke.md",
                "docs/case-studies/isolated-smoke.md",
                "docs/case-studies/isolated-smoke.csv",
            ]
            values = [
                "# Snapshot reference\n\n[Case study](../../../../docs/case-studies/isolated-smoke.md).\n",
                "# Case study\n\n[Measurements](isolated-smoke.csv).\n",
                'id,description\nR01,"A, B"\n',
            ]
            for name, value in zip(names, values, strict=True):
                path = snapshot / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value, encoding="utf-8", newline="\n")
            subprocess.run(["git", "add", "--all", "--force"], cwd=snapshot, check=True)
            env = {**os.environ, "CHANGE_SCOPE_JSON": json.dumps({"files": names})}

            def check():
                self.assertFalse((snapshot / "node_modules").exists())
                return subprocess.run(
                    [sys.executable, str(snapshot / checker), "--tool-root", str(repository)],
                    cwd=snapshot,
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )

            before = {name: (snapshot / name).read_bytes() for name in names}
            result = check()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Package content check passed", result.stdout)
            self.assertIn("(content only)", result.stdout)
            self.assertIn("Documentation gate passed", result.stdout)
            self.assertNotIn("portable example audit", result.stdout)
            self.assertNotIn("npm ci", result.stdout)
            self.assertFalse((snapshot / "node_modules").exists())
            self.assertFalse((snapshot / "example/build/example.docx").exists())
            self.assertEqual(before, {name: (snapshot / name).read_bytes() for name in names})

            # This paragraph is preserved by the tool-root's default proseWrap,
            # but must fail the snapshot's explicit 40-column wrapping policy.
            (snapshot / names[1]).write_text(
                "# Case study\n\nThis paragraph deliberately exceeds the snapshot width and must be wrapped by its policy.\n",
                encoding="utf-8",
                newline="\n",
            )
            result = check()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Markdown formatting differs", result.stderr)
            (snapshot / names[1]).write_text(values[1], encoding="utf-8", newline="\n")

            (snapshot / names[2]).write_text(
                "id,description\nR01\n", encoding="utf-8", newline="\n"
            )
            result = check()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Invalid CSV record width", result.stderr)
            (snapshot / names[2]).write_text(values[2], encoding="utf-8", newline="\n")

            (snapshot / names[0]).write_text(
                "# Snapshot reference\n\n[Missing](missing.md).\n",
                encoding="utf-8",
                newline="\n",
            )
            result = check()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing local Markdown link target", result.stderr)


if __name__ == "__main__":
    unittest.main()
