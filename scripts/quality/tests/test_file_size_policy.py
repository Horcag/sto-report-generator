"""Contract tests for the file-size debt ratchet."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.quality.file_size_policy import (
    EXIT_CONFIGURATION_ERROR,
    EXIT_CRITICAL,
    EXIT_OK,
    EXIT_POLICY_ERROR,
    Thresholds,
    build_reduced_baseline,
    discover_source_files,
    evaluate_file_sizes,
    write_baseline,
)

CHECKER = Path(__file__).resolve().parents[1] / "check_file_size.py"
THRESHOLDS = Thresholds(350, 500, 1000)


class FileSizePolicyTests(unittest.TestCase):
    def test_strict_thresholds_only_flag_sizes_above_the_boundary(self) -> None:
        result = evaluate_file_sizes(
            {
                "at-warning.py": 350,
                "warning.py": 351,
                "at-error.py": 500,
                "error.py": 501,
                "critical.py": 1001,
            },
            baseline={},
            thresholds=THRESHOLDS,
        )

        findings = {item.path: item for item in result.findings}
        self.assertNotIn("at-warning.py", findings)
        self.assertEqual(findings["warning.py"].status, "new-warning")
        self.assertEqual(findings["at-error.py"].severity, "warning")
        self.assertTrue(findings["error.py"].blocking)
        self.assertEqual(result.exit_code, EXIT_CRITICAL)

    def test_unchanged_legacy_debt_is_allowed_but_growth_is_blocking(self) -> None:
        unchanged = evaluate_file_sizes(
            {"legacy.ts": 600}, baseline={"legacy.ts": 600}, thresholds=THRESHOLDS
        )
        grown = evaluate_file_sizes(
            {"legacy.ts": 601}, baseline={"legacy.ts": 600}, thresholds=THRESHOLDS
        )

        self.assertEqual(unchanged.exit_code, EXIT_OK)
        self.assertEqual(unchanged.findings[0].status, "baselined")
        self.assertEqual(grown.exit_code, EXIT_POLICY_ERROR)
        self.assertEqual(grown.findings[0].status, "regression")

    def test_reduction_or_removal_removes_baseline_debt(self) -> None:
        reduced = build_reduced_baseline(
            {"smaller.py": 600, "resolved.py": 350},
            baseline={"smaller.py": 700, "resolved.py": 500, "deleted.py": 600},
            thresholds=THRESHOLDS,
        )

        self.assertEqual(reduced, {"smaller.py": 600})

    def test_baseline_update_refuses_new_or_grown_error_debt(self) -> None:
        with self.assertRaisesRegex(ValueError, "Refusing"):
            build_reduced_baseline(
                {"legacy.py": 701, "new.py": 501},
                baseline={"legacy.py": 700},
                thresholds=THRESHOLDS,
            )

    def test_discovery_is_limited_to_roots_extensions_and_exclusions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src" / "generated").mkdir(parents=True)
            (root / "src" / "keep.py").write_text("line\n", encoding="utf-8")
            (root / "src" / "generated" / "skip.py").write_text("line\n", encoding="utf-8")
            (root / "outside.py").write_text("line\n", encoding="utf-8")

            found = discover_source_files(
                root,
                source_roots=("src",),
                extensions=(".py",),
                excluded_globs=("**/generated/**",),
            )

        self.assertEqual(found, {"src/keep.py": 1})

    def test_cli_rewrites_only_a_reduced_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            (root / "src" / "legacy.py").write_text("line\n" * 600, encoding="utf-8")
            self._write_config(root)
            baseline = root / "baseline.json"
            write_baseline(baseline, {"src/legacy.py": 700}, THRESHOLDS)

            completed = self._run(root, update_baseline=True)

            self.assertEqual(completed.returncode, EXIT_OK)
            self.assertEqual(
                json.loads(baseline.read_text(encoding="utf-8"))["files"], {"src/legacy.py": 600}
            )

    def test_cli_rejects_growth_without_changing_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src").mkdir()
            (root / "src" / "legacy.py").write_text("line\n" * 701, encoding="utf-8")
            self._write_config(root)
            baseline = root / "baseline.json"
            write_baseline(baseline, {"src/legacy.py": 700}, THRESHOLDS)

            completed = self._run(root)

            self.assertEqual(completed.returncode, EXIT_POLICY_ERROR)
            self.assertEqual(json.loads(completed.stdout)["exit_code"], EXIT_POLICY_ERROR)
            self.assertEqual(
                json.loads(baseline.read_text(encoding="utf-8"))["files"]["src/legacy.py"], 700
            )

    def test_cli_has_a_dedicated_configuration_failure_code(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "broken.json").write_text("{}", encoding="utf-8")

            completed = subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--root",
                    str(root),
                    "--config",
                    "broken.json",
                    "--format",
                    "json",
                ],
                capture_output=True,
                check=False,
                text=True,
            )

        self.assertEqual(completed.returncode, EXIT_CONFIGURATION_ERROR)
        self.assertEqual(json.loads(completed.stdout)["exit_code"], EXIT_CONFIGURATION_ERROR)

    @staticmethod
    def _write_config(root: Path) -> None:
        payload = {
            "schema_version": 1,
            "baseline_path": "baseline.json",
            "source_roots": ["src"],
            "extensions": [".py"],
            "excluded_globs": [],
            "thresholds": {"warning_above": 350, "error_above": 500, "critical_above": 1000},
        }
        (root / "policy.json").write_text(json.dumps(payload), encoding="utf-8")

    @staticmethod
    def _run(root: Path, *, update_baseline: bool = False) -> subprocess.CompletedProcess[str]:
        arguments = [
            sys.executable,
            str(CHECKER),
            "--root",
            str(root),
            "--config",
            "policy.json",
            "--format",
            "json",
        ]
        if update_baseline:
            arguments.append("--update-baseline")
        return subprocess.run(
            arguments,
            capture_output=True,
            check=False,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
