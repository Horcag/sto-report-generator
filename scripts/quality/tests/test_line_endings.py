"""Exercise Git's real index and checkout conversions, without third-party packages."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.quality.check_line_endings import check


class LineEndingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.git("init", "--quiet")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "core.safecrlf", "false")
        self.write(".gitattributes", b"* text=auto eol=lf\n*.raw -text\n")
        self.git("add", ".gitattributes")

    def git(self, *args: str, data: bytes | None = None) -> bytes:
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            input=data,
            capture_output=True,
            check=True,
        ).stdout

    def write(self, name: str, content: bytes) -> None:
        (self.root / name).write_bytes(content)

    def raw_index(self, name: str, content: bytes, mode: str = "100644") -> None:
        oid = self.git("hash-object", "-w", "--stdin", data=content).decode().strip()
        self.git("update-index", "--add", "--cacheinfo", mode, oid, name)

    def test_lf_text_passes(self) -> None:
        self.write("good.txt", b"first\nsecond\n")
        self.git("add", "good.txt")
        self.assertEqual(check(self.root), [])

    def test_crlf_worktree_is_detected_after_index_normalization(self) -> None:
        self.write("bad.txt", b"first\r\nsecond\r\n")
        self.git("add", "bad.txt")
        self.assertEqual(check(self.root), ["worktree: 'bad.txt': carriage return; use LF"])

    def test_raw_crlf_blob_is_detected_when_checkout_masks_it(self) -> None:
        self.raw_index("masked.txt", b"first\r\nsecond\r\n")
        self.write("masked.txt", b"first\nsecond\n")
        self.assertEqual(check(self.root), ["index: 'masked.txt': carriage return; use LF"])

    def test_binary_and_explicit_minus_text_are_preserved(self) -> None:
        for name, content in [("binary.bin", b"\0\r\n"), ("fixture.raw", b"text\r\n")]:
            self.raw_index(name, content)
            self.write(name, content)
        self.assertEqual(check(self.root), [])

    def test_binary_without_nul_is_preserved(self) -> None:
        content = b"\x01" * 100 + b"\r\n"
        self.raw_index("control.bin", content)
        self.write("control.bin", content)
        classification = self.git("ls-files", "--eol", "--", "control.bin")
        self.assertIn(b"i/-text", classification)
        self.assertIn(b"w/-text", classification)
        self.assertEqual(check(self.root), [])

    def test_explicit_text_still_rejects_cr_in_control_byte_content(self) -> None:
        self.write(".gitattributes", b"* text eol=lf\n")
        self.git("add", ".gitattributes")
        content = b"\x01" * 100 + b"\r\n"
        self.raw_index("control.txt", content)
        self.write("control.txt", content)
        self.assertEqual(
            check(self.root),
            [
                "index: 'control.txt': carriage return; use LF",
                "worktree: 'control.txt': carriage return; use LF",
            ],
        )

    def test_index_uses_staged_attributes(self) -> None:
        self.raw_index("bad.txt", b"text\r\n")
        self.write(".gitattributes", b"* -text\n")
        self.write("bad.txt", b"text\r\n")
        self.assertEqual(check(self.root), ["index: 'bad.txt': carriage return; use LF"])

    @unittest.skipIf(os.name == "nt", "Windows paths cannot contain tabs, newlines or quotes")
    def test_unusual_paths_are_detected(self) -> None:
        name = 'space tab\tline\n"кириллица.txt'
        self.raw_index(name, b"first\rsecond")
        self.write(name, b"first\rsecond")
        self.assertEqual(
            check(self.root),
            [
                f"index: {name!r}: carriage return; use LF",
                f"worktree: {name!r}: carriage return; use LF",
            ],
        )

    def test_lone_cr_is_detected(self) -> None:
        self.raw_index("lone-cr.txt", b"first\rsecond")
        self.write("lone-cr.txt", b"first\rsecond")
        self.assertEqual(
            check(self.root),
            [
                "index: 'lone-cr.txt': carriage return; use LF",
                "worktree: 'lone-cr.txt': carriage return; use LF",
            ],
        )

    @unittest.skipIf(os.name == "nt", "Symlink creation requires Windows privileges")
    def test_symlinks_are_not_followed(self) -> None:
        self.write("untracked.txt", b"\r\n")
        self.raw_index("link", b"untracked.txt", "120000")
        (self.root / "link").symlink_to("untracked.txt")
        self.assertEqual(check(self.root), [])

    @unittest.skipIf(os.name == "nt", "Windows paths cannot contain arbitrary bytes")
    def test_non_utf8_path_is_detected(self) -> None:
        name = os.fsdecode(b"non-utf8-\xff.txt")
        self.raw_index(name, b"text\r\n")
        self.write(name, b"text\n")
        self.assertEqual(check(self.root), [f"index: {name!r}: carriage return; use LF"])

    def test_deleted_text_still_checks_index_and_untracked_files_are_ignored(self) -> None:
        self.raw_index("deleted.txt", b"text\r\n")
        self.write("untracked.txt", b"text\r\n")
        self.assertEqual(check(self.root), ["index: 'deleted.txt': carriage return; use LF"])

    def test_submodules_are_skipped(self) -> None:
        tree = self.git("write-tree").decode().strip()
        commit = (
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(self.root),
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "commit-tree",
                    tree,
                ],
                input=b"fixture\n",
                capture_output=True,
                check=True,
            )
            .stdout.decode()
            .strip()
        )
        self.git("update-index", "--add", "--cacheinfo", "160000", commit, "submodule")
        self.assertEqual(check(self.root), [])


if __name__ == "__main__":
    unittest.main()
