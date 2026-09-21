"""Regression tests for the local Markdown link checker."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).parents[2] / "scripts" / "quality" / "check_markdown_links.py"
SPEC = importlib.util.spec_from_file_location("check_markdown_links", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {SCRIPT_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class MarkdownLinkCheckerTests(unittest.TestCase):
    def test_accepts_existing_local_and_remote_links(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "docs").mkdir()
            (root / "docs" / "guide.md").write_text("# Guide\n", encoding="utf-8")
            (root / "README.md").write_text(
                "[Guide](docs/guide.md)\n[Website](https://example.com)\n```markdown\n[Example](missing.md)\n```\n",
                encoding="utf-8",
            )

            self.assertEqual(MODULE.check_markdown_links(root), [])

    def test_reports_missing_or_outside_local_links(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "README.md").write_text(
                "[Missing](docs/missing.md)\n[Outside](../outside.md)\n",
                encoding="utf-8",
            )

            issues = MODULE.check_markdown_links(root)

            self.assertEqual(len(issues), 2)
            self.assertEqual(
                {issue.target for issue in issues}, {"docs/missing.md", "../outside.md"}
            )

    def test_ignores_generated_and_dependency_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "reports" / "private").mkdir(parents=True)
            (root / "reports" / "private" / "README.md").write_text(
                "[Missing](missing.md)\n",
                encoding="utf-8",
            )
            (root / "README.md").write_text("# Root\n", encoding="utf-8")

            self.assertEqual(MODULE.check_markdown_links(root), [])


if __name__ == "__main__":
    unittest.main()
