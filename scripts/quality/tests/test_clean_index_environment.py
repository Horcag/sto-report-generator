"""Nested Git fixtures must not inherit the invoking hook's repository binding."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.run_clean_index_quality import isolated_git_environment


class CleanIndexEnvironmentTests(unittest.TestCase):
    def test_nested_git_init_preserves_parent_repository(self) -> None:
        git = shutil.which("git")
        self.assertIsNotNone(git, "Git is required for the repository isolation test")
        assert git is not None
        clean = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        clean.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        with tempfile.TemporaryDirectory(prefix="sto-git-isolation-") as temporary:
            parent = Path(temporary) / "parent"
            child = Path(temporary) / "child"
            child.mkdir()
            subprocess.run(
                [git, "-c", "init.templateDir=", "init", str(parent)],
                env=clean,
                check=True,
                capture_output=True,
            )
            parent_config = parent / ".git" / "config"
            before = parent_config.read_bytes()
            inherited = dict(
                clean,
                GIT_DIR=str(parent / ".git"),
                GIT_WORK_TREE=str(parent),
                GIT_INDEX_FILE=str(parent / ".git" / "index"),
                GIT_SSH_COMMAND="preserve-test-value",
            )
            with patch.dict(os.environ, inherited, clear=True):
                isolated = isolated_git_environment(parent, git)
            for key in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]:
                self.assertNotIn(key, isolated)
            self.assertEqual(isolated["GIT_SSH_COMMAND"], "preserve-test-value")
            subprocess.run(
                [git, "-c", "init.templateDir=", "init"],
                cwd=child,
                env=isolated,
                check=True,
                capture_output=True,
            )
            self.assertTrue((child / ".git").is_dir())
            self.assertEqual(parent_config.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
