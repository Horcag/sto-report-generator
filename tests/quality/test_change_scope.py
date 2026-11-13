"""Scope decisions and real Git histories, including failure/rename/deletion paths."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.change_scope import (
    Change,
    classify,
    collect_plan,
    github_plan,
    has_report_source,
    parse_changes,
    protected_ref,
)
from scripts.quality.check_line_endings import check as check_line_endings
from scripts.quality.run_clean_index_quality import export_snapshot, push_plan


class ScopeTests(unittest.TestCase):
    def plan(self, *paths):
        return classify([Change("M", (p,)) for p in paths], dict.fromkeys(paths, "# Guide\n"))

    def test_ordinary_docs_and_skills_use_one_documentation_gate(self):
        for name in [
            "README.md",
            "docs/report-authoring.md",
            "docs/case-studies/study.md",
            ".agents/skills/sto-report-generator/SKILL.md",
            ".agents/skills/humanizer-ru/references/rewrite-guide.md",
            "docs/case-studies/russian-report-measurements.csv",
        ]:
            with self.subTest(name=name):
                plan = self.plan(name)
                self.assertFalse(plan.full)
                self.assertFalse(plan.workflow_lint)
                self.assertFalse(plan.gallery)

    def test_code_policies_inputs_and_unknowns_remain_full(self):
        for name in [
            "AGENTS.md",
            "docs/AGENTS.override.md",
            ".agents/skills/test/AGENTS.md",
            "src/a.ts",
            "src/templates/input.md",
            "tests/fixtures/input.md",
            "example/03_body.md",
            "reports/lab/a.md",
            "package.json",
            "package-lock.json",
            "uv.lock",
            "pyproject.toml",
            ".pre-commit-config.yaml",
            "quality/inputs.json",
            ".github/workflows/ci.yml",
            "docs/unknown.bin",
            "docs/data.csv",
            "docs/case-studies/nested/input.csv",
            "tests/fixtures/data.csv",
            "docs/examples/render.md",
            "docs/profiles/lab.md",
            ".agents/skills/custom/examples/report.md",
            ".agents/skills/custom/fixtures/x.md",
            ".agents/skills/custom/templates/input.md",
            "new-root.md",
            "docs/a\nb.md",
        ]:
            with self.subTest(name=name):
                self.assertTrue(self.plan(name).full)
        self.assertTrue(self.plan("README.md", "src/a.ts").full)
        self.assertTrue(self.plan(".github/workflows/ci.yml").workflow_lint)
        self.assertFalse(self.plan("src/a.ts").workflow_lint)

    def test_gallery_outputs_are_docs_with_manifest_verification(self):
        for name in [
            "docs/gallery.md",
            "docs/assets/gallery/manifest.json",
            "docs/assets/gallery/a.png",
        ]:
            plan = self.plan(name)
            self.assertFalse(plan.full)
            self.assertTrue(plan.gallery)

    def test_report_content_at_arbitrary_doc_filename_is_not_docs_only(self):
        for text in [
            "---\nreportType: lab\n---\n# Body\n",
            "---\nstudentName: Example\n---\n",
            "\\sto_structural_heading{ВВЕДЕНИЕ}\n",
            "\\begin{sto_bibliography}\n\\end{sto_bibliography}\n",
        ]:
            self.assertTrue(has_report_source(text))
            self.assertTrue(
                classify([Change("M", ("docs/unexpected.md",))], {"docs/unexpected.md": text}).full
            )
        self.assertFalse(has_report_source("# Guide\n```latex\n\\sto_structural_heading{X}\n```\n"))
        self.assertFalse(
            has_report_source("---\nname: skill\ndescription: Example\n---\n# Guide\n")
        )

    def test_rename_checks_both_paths_and_deletion_keeps_path(self):
        self.assertFalse(
            classify(
                [Change("R100", ("docs/old.md", "docs/new.md"))],
                {"docs/old.md": "", "docs/new.md": ""},
            ).full
        )
        self.assertTrue(
            classify([Change("R100", ("tests/input.md", "docs/new.md"))], {"docs/new.md": ""}).full
        )
        self.assertTrue(
            classify([Change("R100", ("docs/old.md", "tests/new.md"))], {"docs/old.md": ""}).full
        )
        self.assertFalse(classify([Change("D", ("docs/old.md",))], {"docs/old.md": ""}).full)
        self.assertTrue(classify([Change("D", ("example/report.md",))]).full)

    def test_unknown_empty_and_incomplete_evidence_fail_full(self):
        for plan in [
            classify([]),
            classify([Change("U", ("README.md",))]),
            classify([Change("R100", ("README.md",))]),
            classify([Change("M", ("README.md",))]),
        ]:
            self.assertTrue(plan.full)
        self.assertEqual(
            parse_changes(b"R100\0docs/old.md\0docs/new.md\0D\0README.md\0"),
            [Change("R100", ("docs/old.md", "docs/new.md")), Change("D", ("README.md",))],
        )
        for raw in [b"M\0README.md", b"R100\0README.md\0", b"X\0README.md\0", b"M\0\xff.md\0"]:
            with self.assertRaises((ValueError, UnicodeError)):
                parse_changes(raw)

    def test_protected_push_and_non_pr_events_always_full(self):
        for ref in [
            "refs/heads/master",
            "main",
            "refs/heads/release/1.2",
            "release",
            "refs/tags/v1.2.3",
        ]:
            self.assertTrue(protected_ref(ref))
            self.assertTrue(push_plan(Path.cwd(), {"PRE_COMMIT_REMOTE_BRANCH": ref}).full)
        self.assertFalse(protected_ref("refs/heads/document-release-notes"))
        for event in ["push", "workflow_dispatch", "merge_group", "", "pull_request_target"]:
            self.assertTrue(github_plan(Path.cwd(), event, {}).full)
        self.assertTrue(github_plan(Path.cwd(), "pull_request", {}).full)
        self.assertTrue(
            github_plan(
                Path.cwd(), "pull_request", {"pull_request": {"base": {"ref": "release/1"}}}
            ).full
        )


class GitScopeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.git("init", "-q", "-b", "master")
        self.git("config", "user.email", "scope@example.invalid")
        self.git("config", "user.name", "Scope tests")
        self.git("config", "core.autocrlf", "false")
        self.write("README.md", "# Initial\n")
        self.base = self.commit()

    def git(self, *args):
        return (
            subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE)
            .decode()
            .strip()
        )

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")

    def commit(self):
        self.git("add", "--all")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def test_real_docs_mixed_rename_delete_and_missing_history(self):
        self.write("docs/old.md", "# Guide\n")
        docs = self.commit()
        self.assertFalse(collect_plan(self.root, self.base, docs).full)
        self.git("mv", "docs/old.md", "docs/new.md")
        renamed = self.commit()
        self.assertFalse(collect_plan(self.root, docs, renamed).full)
        self.git("rm", "docs/new.md")
        deleted = self.commit()
        self.assertFalse(collect_plan(self.root, renamed, deleted).full)
        self.write("README.md", "# Changed\n")
        self.write("src/runtime.ts", "export const value = 1;\n")
        mixed = self.commit()
        self.assertTrue(collect_plan(self.root, deleted, mixed).full)
        for old, new in [
            (mixed, mixed),
            ("0" * 40, mixed),
            ("missing", mixed),
            (self.base, "missing"),
        ]:
            self.assertTrue(collect_plan(self.root, old, new).full)
        with patch("scripts.quality.change_scope.git", side_effect=PermissionError("fetch denied")):
            self.assertTrue(collect_plan(self.root, self.base, mixed).full)

    def test_pr_uses_merge_base_not_advanced_base_diff(self):
        self.git("checkout", "-qb", "topic")
        self.write("docs/guide.md", "# Guide\n")
        head = self.commit()
        self.git("checkout", "-q", "master")
        self.write("src/base.ts", "export {};\n")
        advanced = self.commit()
        payload = {
            "pull_request": {"base": {"ref": "master", "sha": advanced}, "head": {"sha": head}}
        }
        self.assertFalse(github_plan(self.root, "pull_request", payload).full)

    def test_report_metadata_added_or_deleted_at_doc_path_is_full(self):
        self.write("docs/guide.md", "# Guide\n")
        before = self.commit()
        self.write("docs/guide.md", "---\nreportType: lab\n---\n# Body\n")
        after = self.commit()
        self.assertTrue(collect_plan(self.root, before, after).full)
        self.git("rm", "docs/guide.md")
        removed = self.commit()
        self.assertTrue(collect_plan(self.root, after, removed).full)

    @unittest.skipIf(os.name == "nt", "symlink requires Windows privilege")
    def test_symlink_is_not_ordinary_documentation(self):
        (self.root / "docs").mkdir()
        (self.root / "docs/guide.md").symlink_to("../README.md")
        head = self.commit()
        self.assertTrue(collect_plan(self.root, self.base, head).full)

    def test_pushed_crlf_cannot_be_hidden_by_clean_staged_text(self):
        raw = b"# Committed CRLF\r\n"
        (self.root / "README.md").write_bytes(raw)
        # Bypass Git clean filters deliberately: this tests a bad committed blob,
        # even on hosts whose global attributes normalize ordinary `git add`.
        blob = (
            subprocess.check_output(
                ["git", "hash-object", "-w", "--stdin"],
                cwd=self.root,
                input=raw,
            )
            .decode()
            .strip()
        )
        self.git("update-index", "--cacheinfo", "100644", blob, "README.md")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "raw CRLF fixture")
        pushed = self.git("rev-parse", "HEAD")
        (self.root / "README.md").write_bytes(b"# Clean staged text\n")
        self.git("add", "README.md")
        self.assertEqual(check_line_endings(self.root), [])
        snapshot = Path(self.temporary.name) / "crlf-snapshot"
        snapshot.mkdir()
        export_snapshot(self.root, snapshot, "git", pushed)
        self.assertTrue(check_line_endings(snapshot))

    def test_snapshot_keeps_committed_files_even_when_ignored(self):
        self.write(".gitignore", "docs/retained.md\n")
        self.write("docs/retained.md", "# Tracked despite ignore rule\n")
        self.git("add", "--force", "docs/retained.md")
        pushed = self.commit()
        snapshot = Path(self.temporary.name) / "ignored-snapshot"
        snapshot.mkdir()
        export_snapshot(self.root, snapshot, "git", pushed)
        tracked = (
            subprocess.check_output(
                ["git", "ls-files", "--", "docs/retained.md"],
                cwd=snapshot,
            )
            .decode()
            .strip()
        )
        self.assertEqual(tracked, "docs/retained.md")

    def test_snapshot_checks_actual_push_not_dirty_index(self):
        self.write("README.md", "# Committed docs\n")
        pushed = self.commit()
        self.write("README.md", "# Unrelated staged edit\n")
        self.git("add", "README.md")
        target = Path(self.temporary.name) / "snapshot"
        target.mkdir()
        export_snapshot(self.root, target, "git", pushed)
        self.assertEqual((target / "README.md").read_text(), "# Committed docs\n")
        self.assertTrue((target / ".git/index").exists())
        env = {
            "PRE_COMMIT_FROM_REF": self.base,
            "PRE_COMMIT_TO_REF": pushed,
            "PRE_COMMIT_REMOTE_BRANCH": "refs/heads/topic",
        }
        self.assertFalse(push_plan(self.root, env).full)


if __name__ == "__main__":
    unittest.main()
