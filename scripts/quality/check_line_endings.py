#!/usr/bin/env python3
"""Reject carriage returns in tracked text, checking raw index blobs and worktree bytes."""

from __future__ import annotations

import argparse
import os
import stat
import subprocess
import sys
from pathlib import Path


def git(root: Path, *args: str, data: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        input=data,
        capture_output=True,
        check=True,
    ).stdout


def text_attributes(root: Path, paths: list[bytes], *, cached: bool) -> dict[bytes, bytes]:
    args = ["check-attr", "-z", "--stdin"]
    if cached:
        args.append("--cached")
    fields = git(root, *args, "text", data=b"\0".join(paths) + b"\0").split(b"\0")
    return {fields[i]: fields[i + 2] for i in range(0, len(fields) - 1, 3)}


def is_binary(content: bytes) -> bool:
    if b"\0" in content:
        return True
    # Match Git's conversion heuristic for control bytes. CR stays an ending
    # violation in text rather than making an otherwise textual file binary.
    controls = bytes(value for value in range(32) if value not in {8, 9, 10, 12, 13, 27})
    nonprintable = len(content) - len(content.translate(None, controls + b"\x7f"))
    printable = len(content) - nonprintable - content.count(b"\r") - content.count(b"\n")
    return nonprintable * 128 > printable


def has_invalid_endings(content: bytes, attribute: bytes) -> bool:
    if attribute == b"unset":
        return False
    if attribute in {b"auto", b"unspecified"} and is_binary(content):
        return False
    return b"\r" in content


def check(root: Path) -> list[str]:
    records = git(root, "ls-files", "--stage", "-z").split(b"\0")
    entries: list[tuple[bytes, bytes]] = []
    for record in filter(None, records):
        metadata, path = record.split(b"\t", 1)
        mode, oid, stage = metadata.split()
        if stage != b"0":
            raise ValueError(f"Unmerged index entry: {os.fsdecode(path)!r}")
        if mode in {b"100644", b"100755"}:
            entries.append((path, oid))
    if not entries:
        return []
    paths = [path for path, _ in entries]
    index_attributes = text_attributes(root, paths, cached=True)
    worktree_attributes = text_attributes(root, paths, cached=False)
    findings = []
    # Feed object IDs, never paths: filenames can contain tabs, newlines or non-UTF-8 bytes.
    with subprocess.Popen(
        ["git", "-C", str(root), "cat-file", "--batch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    ) as batch:
        assert batch.stdin is not None and batch.stdout is not None
        try:
            for path, oid in entries:
                batch.stdin.write(oid + b"\n")
                batch.stdin.flush()
                header = batch.stdout.readline().split()
                if len(header) != 3 or header[1] != b"blob":
                    raise ValueError(f"Cannot read index blob: {os.fsdecode(path)!r}")
                content = batch.stdout.read(int(header[2]))
                if batch.stdout.read(1) != b"\n":
                    raise ValueError("Invalid git cat-file response")
                label = repr(os.fsdecode(path))
                if has_invalid_endings(content, index_attributes[path]):
                    findings.append(f"index: {label}: carriage return; use LF")
                file = root / os.fsdecode(path)
                try:
                    worktree_mode = file.lstat().st_mode
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(worktree_mode) and has_invalid_endings(
                    file.read_bytes(), worktree_attributes[path]
                ):
                    findings.append(f"worktree: {label}: carriage return; use LF")
        finally:
            batch.stdin.close()
            batch.wait()
        if batch.returncode:
            raise ValueError(f"git cat-file exited with {batch.returncode}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    options = parser.parse_args()
    try:
        root = Path(
            os.fsdecode(git(options.root, "rev-parse", "--show-toplevel").removesuffix(b"\n"))
        )
        findings = check(root)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Line-ending check failed: {error}", file=sys.stderr)
        return 2
    for finding in findings:
        print(finding)
    print(f"Line endings: {len(findings)} violation(s) in index and worktree")
    return int(bool(findings))


if __name__ == "__main__":
    sys.exit(main())
