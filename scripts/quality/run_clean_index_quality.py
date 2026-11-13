#!/usr/bin/env python3
"""Validate the pushed commit (or prepared index) with a proportional isolated gate."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import asdict
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.quality.change_scope import Plan, collect_plan, protected_ref


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


def push_plan(repository: Path, env: dict[str, str]) -> Plan:
    if protected_ref(env.get("PRE_COMMIT_REMOTE_BRANCH", "")):
        return Plan(True, "Protected branch or release push")
    return collect_plan(
        repository, env.get("PRE_COMMIT_FROM_REF", ""), env.get("PRE_COMMIT_TO_REF", "")
    )


def export_snapshot(repository: Path, snapshot: Path, git: str, revision: str) -> None:
    if revision:
        # Validate the actual pushed commit, never unrelated staged/worktree edits.
        archive = subprocess.check_output(
            [git, "archive", "--format=tar", revision], cwd=repository
        )
        with tarfile.open(fileobj=io.BytesIO(archive)) as content:
            content.extractall(snapshot, filter="data")
    else:
        run([git, "checkout-index", "--all", f"--prefix={snapshot}{os.sep}"], cwd=repository)
    # LF and package checks need a real index, isolated from the source worktree.
    env = isolated_git_environment(repository, git)
    run([git, "init", "--quiet"], cwd=snapshot, env=env)
    run([git, "config", "core.autocrlf", "false"], cwd=snapshot, env=env)
    run([git, "add", "--all"], cwd=snapshot, env=env)


def main() -> int:
    repository = Path.cwd().resolve()
    git = command("git")
    plan = push_plan(repository, dict(os.environ))
    print(f"Pre-push scope: {'full' if plan.full else 'documentation'} — {plan.reason}", flush=True)
    with tempfile.TemporaryDirectory(prefix="sto-quality-index-") as temporary:
        snapshot = Path(temporary) / "snapshot"
        snapshot.mkdir()
        export_snapshot(repository, snapshot, git, os.environ.get("PRE_COMMIT_TO_REF", ""))
        snapshot_env = isolated_git_environment(repository, git)
        if plan.full:
            run([command("npm"), "ci"], cwd=snapshot, env=snapshot_env)
            run(
                [command("uv"), "sync", "--frozen", "--group", "dev"],
                cwd=snapshot,
                env=snapshot_env,
            )
            run([command("npm"), "run", "quality"], cwd=snapshot, env=snapshot_env)
        else:
            # Formatting/YAML tools are already installed for normal local hooks.
            # The checked files and checker implementation come from the snapshot.
            snapshot_env["CHANGE_SCOPE_JSON"] = json.dumps(asdict(plan))
            run(
                [
                    sys.executable,
                    "scripts/quality/check_documentation.py",
                    "--tool-root",
                    str(repository),
                ],
                cwd=snapshot,
                env=snapshot_env,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
