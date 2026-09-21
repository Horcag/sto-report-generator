#!/usr/bin/env python3
"""Run the full quality gate against the prepared Git index in isolation."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def command(name: str) -> str:
    executable = f"{name}.cmd" if os.name == "nt" else name
    resolved = shutil.which(executable)
    if resolved is None:
        raise RuntimeError(f"Required executable is unavailable: {executable}")
    return resolved


def run(args: list[str], *, cwd: Path) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def main() -> int:
    repository = Path.cwd().resolve()
    git = command("git")
    with tempfile.TemporaryDirectory(prefix="sto-quality-index-") as temporary:
        snapshot = Path(temporary) / "snapshot"
        snapshot.mkdir()
        prefix = f"{snapshot}{os.sep}"
        run([git, "checkout-index", "--all", f"--prefix={prefix}"], cwd=repository)
        run([command("npm"), "ci"], cwd=snapshot)
        run([command("uv"), "sync", "--frozen", "--group", "dev"], cwd=snapshot)
        run([command("npm"), "run", "quality"], cwd=snapshot)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
