"""Prove documentation pre-push omits installs/full suites and failures clean snapshots."""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.change_scope import Plan
from scripts.quality.run_clean_index_quality import main


class PrePushExecutionTests(unittest.TestCase):
    def execute(self, plan, fail=False):
        calls = []

        def record(args, *, cwd, env=None):
            calls.append((args, cwd, env))
            if fail:
                raise subprocess.CalledProcessError(1, args)

        with (
            patch("scripts.quality.run_clean_index_quality.push_plan", return_value=plan),
            patch("scripts.quality.run_clean_index_quality.command", side_effect=lambda name: name),
            patch("scripts.quality.run_clean_index_quality.export_snapshot"),
            patch(
                "scripts.quality.run_clean_index_quality.isolated_git_environment", return_value={}
            ),
            patch("scripts.quality.run_clean_index_quality.run", side_effect=record),
        ):
            if fail:
                with self.assertRaises(subprocess.CalledProcessError):
                    main()
            else:
                self.assertEqual(main(), 0)
        self.assertTrue(calls)
        self.assertTrue(all(not cwd.exists() for _, cwd, _ in calls))
        return calls

    def test_documentation_executes_only_docs_gate_without_dependency_install(self):
        calls = self.execute(Plan(False, "docs", ("README.md",), False))
        self.assertEqual(len(calls), 1)
        args, _, env = calls[0]
        self.assertEqual(
            args[:3], [sys.executable, "scripts/quality/check_documentation.py", "--tool-root"]
        )
        self.assertIn("CHANGE_SCOPE_JSON", env)
        self.assertIn(str(Path.cwd()), args)

    def test_full_executes_existing_dependency_and_quality_contract(self):
        calls = self.execute(Plan(True, "code"))
        self.assertEqual(
            [args for args, _, _ in calls],
            [
                [sys.executable, "scripts/quality/check_line_endings.py"],
                ["npm", "ci"],
                ["uv", "sync", "--frozen", "--group", "dev"],
                ["npm", "run", "quality"],
            ],
        )

    def test_failed_documentation_gate_is_not_swallowed_and_snapshot_is_removed(self):
        self.execute(Plan(False, "docs", ("README.md",), False), fail=True)


if __name__ == "__main__":
    unittest.main()
