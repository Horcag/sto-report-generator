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


def run(args: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=cwd, env=env, check=True)


def isolated_git_environment(repository: Path, git: str) -> dict[str, str]:
    local_names = subprocess.check_output(
        [git, "rev-parse", "--local-env-vars"], cwd=repository, text=True
    ).splitlines()
    return {key: value for key, value in os.environ.items() if key not in local_names}


def main() -> int:
    repository = Path.cwd().resolve()
    git = command("git")
    with tempfile.TemporaryDirectory(prefix="sto-quality-index-") as temporary:
        snapshot = Path(temporary) / "snapshot"
        snapshot.mkdir()
        prefix = f"{snapshot}{os.sep}"
        run([git, "checkout-index", "--all", f"--prefix={prefix}"], cwd=repository)
        snapshot_env = isolated_git_environment(repository, git)
        run([command("npm"), "ci"], cwd=snapshot, env=snapshot_env)
        run([command("uv"), "sync", "--frozen", "--group", "dev"], cwd=snapshot, env=snapshot_env)
        run([command("npm"), "run", "quality"], cwd=snapshot, env=snapshot_env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
