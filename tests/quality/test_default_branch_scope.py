"""Exact default-branch push ranges using independent synthetic Git histories."""

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.change_scope import github_plan


class DefaultBranchScopeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "-q", "-b", "master")
        self.git("config", "user.email", "scope@example.invalid")
        self.git("config", "user.name", "Scope tests")
        self.git("config", "core.autocrlf", "false")
        self.write("README.md", "# Initial\n")
        self.base = self.commit()
        self.write("docs/guide.md", "# Guide\n")
        self.head = self.commit()

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

    def payload(self, branch="master"):
        return {
            "repository": {"default_branch": branch},
            "ref": f"refs/heads/{branch}",
            "before": self.base,
            "after": self.head,
            "created": False,
            "deleted": False,
            "forced": False,
        }

    def test_normal_master_and_main_pushes_use_documentation_scope(self):
        for branch in ("master", "main"):
            with self.subTest(branch=branch):
                plan = github_plan(self.root, "push", self.payload(branch))
                self.assertFalse(plan.full)
                self.assertEqual(plan.files, ("docs/guide.md",))
                self.assertFalse(plan.workflow_lint)

    def test_default_main_pull_request_uses_same_scoping(self):
        payload = {
            "repository": {"default_branch": "main"},
            "pull_request": {
                "base": {"ref": "main", "sha": self.base},
                "head": {"sha": self.head},
            },
        }
        self.assertFalse(github_plan(self.root, "pull_request", payload).full)

    def test_created_deleted_forced_missing_and_unknown_flags_remain_full(self):
        for flag in ("created", "deleted", "forced"):
            for value in (True, None, "false", 0):
                with self.subTest(flag=flag, value=value):
                    payload = self.payload()
                    payload[flag] = value
                    self.assertTrue(github_plan(self.root, "push", payload).full)
            payload = self.payload()
            del payload[flag]
            self.assertTrue(github_plan(self.root, "push", payload).full)

    def test_release_tags_other_refs_and_non_default_branches_remain_full(self):
        for ref in (
            "refs/heads/release/1",
            "refs/tags/v1.2.3",
            "refs/heads/topic",
            "refs/heads/main",
            None,
        ):
            payload = self.payload()
            payload["ref"] = ref
            self.assertTrue(github_plan(self.root, "push", payload).full)
        for repository in (
            {},
            None,
            "master",
            {"default_branch": "develop"},
            {"default_branch": ["master"]},
        ):
            payload = self.payload()
            payload["repository"] = repository
            self.assertTrue(github_plan(self.root, "push", payload).full)
        for event in ("workflow_dispatch", "merge_group", "pull_request_target", "unknown"):
            self.assertTrue(github_plan(self.root, event, self.payload()).full)

    def test_empty_abbreviated_zero_and_missing_endpoints_remain_full(self):
        for before, after in [
            (self.head, self.head),
            (self.base[:8], self.head),
            (self.base, "HEAD"),
            ("0" * 40, self.head),
            (None, self.head),
            (self.base, "f" * 40),
        ]:
            payload = self.payload()
            payload.update(before=before, after=after)
            self.assertTrue(github_plan(self.root, "push", payload).full)
        with patch(
            "scripts.quality.change_scope.git", side_effect=PermissionError("history unavailable")
        ):
            self.assertTrue(github_plan(self.root, "push", self.payload()).full)
        self.assertTrue(github_plan(self.root, "push", []).full)

    def test_diverged_and_unrelated_histories_do_not_use_merge_base_shortcut(self):
        self.git("checkout", "-qb", "side", self.base)
        self.write("docs/side.md", "# Side\n")
        diverged = self.commit()
        payload = self.payload()
        payload.update(before=self.head, after=diverged)
        self.assertTrue(github_plan(self.root, "push", payload).full)
        self.git("checkout", "--orphan", "unrelated")
        self.write("docs/orphan.md", "# Unrelated\n")
        unrelated = self.commit()
        payload["after"] = unrelated
        self.assertTrue(github_plan(self.root, "push", payload).full)

    def test_code_formatting_and_executable_skill_inputs_remain_full(self):
        for name in ["src/runtime.ts", ".prettierrc", ".agents/skills/report/examples/input.md"]:
            before = self.git("rev-parse", "HEAD")
            self.write(name, "changed\n")
            after = self.commit()
            payload = self.payload()
            payload.update(before=before, after=after)
            plan = github_plan(self.root, "push", payload)
            self.assertTrue(plan.full)
            self.assertIn(name, plan.files)

    def test_merge_introducing_code_remains_full(self):
        self.git("checkout", "-qb", "code", self.head)
        self.write("src/runtime.ts", "export const value = 1;\n")
        self.commit()
        self.git("checkout", "-q", "master")
        self.write("docs/other.md", "# Other\n")
        before = self.commit()
        self.git("-c", "commit.gpgsign=false", "merge", "--no-ff", "--no-edit", "code")
        payload = self.payload()
        payload.update(before=before, after=self.git("rev-parse", "HEAD"))
        plan = github_plan(self.root, "push", payload)
        self.assertTrue(plan.full)
        self.assertIn("src/runtime.ts", plan.files)

    def test_tag_object_is_not_accepted_as_exact_commit_endpoint(self):
        self.git("-c", "tag.gpgsign=false", "tag", "-am", "fixture", "before-tag", self.base)
        payload = self.payload()
        payload["before"] = self.git("rev-parse", "before-tag")
        self.assertTrue(github_plan(self.root, "push", payload).full)


if __name__ == "__main__":
    unittest.main()
