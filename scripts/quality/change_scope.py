"""Classify proven Git changes; incomplete evidence always selects the full gate."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath


@dataclass(frozen=True)
class Change:
    status: str
    paths: tuple[str, ...]


@dataclass(frozen=True)
class Plan:
    full: bool
    reason: str
    files: tuple[str, ...] = ()
    workflow_lint: bool = True
    gallery: bool = False


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.PIPE)


def parse_changes(raw: bytes) -> list[Change]:
    fields = raw.decode("utf-8", errors="strict").split("\0")
    if fields[-1] != "":
        raise ValueError("Git name-status output is not NUL terminated")
    changes = []
    index = 0
    while index < len(fields) - 1:
        status = fields[index]
        count = 2 if re.fullmatch(r"[RC]\d+", status) else 1
        if not re.fullmatch(r"[AMD]|[RC]\d+", status):
            raise ValueError(f"Unknown Git change status: {status!r}")
        paths = tuple(fields[index + 1 : index + 1 + count])
        if len(paths) != count or any(not p for p in paths):
            raise ValueError("Incomplete Git change record")
        changes.append(Change(status, paths))
        index += count + 1
    return changes


def has_report_source(text: str) -> bool:
    """Recognize actual report content, not fenced examples in skill documentation."""
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            if line.strip() == "---":
                break
            key = line.partition(":")[0].strip().strip("\"'")
            if key in {"reportType", "studentName", "specialtyCode", "profileName", "bibliography"}:
                return True
    fence = ""
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[0]
            if not fence:
                fence = marker
            elif marker == fence:
                fence = ""
            continue
        if not fence and stripped.startswith(("\\sto_", "\\begin{sto_")):
            return True
    return False


def documentation_path(name: str) -> bool:
    path = PurePosixPath(name)
    if path.name.lower() in {"agents.md", "agents.override.md", "claude.md"}:
        return False
    if path.is_absolute() or ".." in path.parts or any(ord(c) < 32 for c in name):
        return False
    if name in {"README.md", "CHANGELOG.md", "ROADMAP.md", "CONTRIBUTING.md", "SECURITY.md"}:
        return True
    if path.parent == PurePosixPath("docs/case-studies") and path.suffix == ".csv":
        return True
    if name.startswith("docs/assets/"):
        return path.suffix.lower() in {".png", ".jpg", ".jpeg", ".svg"} or (
            name.startswith("docs/assets/gallery/") and path.suffix == ".json"
        )
    if path.suffix != ".md":
        return False
    if name.startswith("docs/"):
        return not any(p in {"fixtures", "examples", "templates", "profiles"} for p in path.parts)
    if name.startswith(".agents/skills/"):
        executable_inputs = {
            "tests",
            "fixtures",
            "examples",
            "templates",
            "profiles",
            "eval",
            "research",
        }
        return not any(p in executable_inputs for p in path.parts[3:-1])
    return False


def classify(changes: list[Change], contents: dict[str, str] | None = None) -> Plan:
    files = tuple(sorted({name for change in changes for name in change.paths}))
    lint = any(name.startswith(".github/workflows/") for name in files)
    gallery = any(
        name == "docs/gallery.md" or name.startswith("docs/assets/gallery/") for name in files
    )
    if not files:
        return Plan(True, "No proven changed files")
    for change in changes:
        if not re.fullmatch(r"[AMD]|[RC]\d+", change.status) or len(change.paths) != (
            2 if change.status.startswith(("R", "C")) else 1
        ):
            return Plan(True, "Unknown change status", files)
    if any(not documentation_path(name) for name in files):
        return Plan(
            True, "Code, executable input, policy, or unknown path changed", files, lint, gallery
        )
    if contents is None or any(name not in contents for name in files):
        return Plan(True, "Markdown content evidence is incomplete", files, lint, gallery)
    if any(has_report_source(contents[name]) for name in files if name.endswith(".md")):
        return Plan(
            True, "Markdown is a report source, not ordinary documentation", files, lint, gallery
        )
    return Plan(
        False, "Only documentation and documentation resources changed", files, lint, gallery
    )


def collect_plan(root: Path, base: str, head: str, *, exact_range: bool = False) -> Plan:
    try:
        if not base or not head or set(base) == {"0"} or set(head) == {"0"}:
            return Plan(True, "Missing or zero revision")
        base_sha = git(root, "rev-parse", "--verify", f"{base}^{{commit}}").decode().strip()
        head_sha = git(root, "rev-parse", "--verify", f"{head}^{{commit}}").decode().strip()
        merge_base = git(root, "merge-base", base_sha, head_sha).decode().strip()
        if exact_range and (base_sha != base or head_sha != head):
            return Plan(True, "Push endpoints are not exact commit identifiers")
        if exact_range and merge_base != base_sha:
            return Plan(True, "Push is not a forward ancestor range")
        # PRs compare their merge base; proven pushes compare the exact endpoints.
        diff_base = base_sha if exact_range else merge_base
        changes = parse_changes(
            git(root, "diff", "--name-status", "-z", "--find-renames", diff_base, head_sha)
        )
        contents = {}
        for change in changes:
            for name in change.paths:
                if not documentation_path(name):
                    continue
                values = []
                for revision in (diff_base, head_sha):
                    entry = git(root, "ls-tree", "-z", revision, "--", name)
                    if not entry:
                        continue
                    if not entry.startswith((b"100644 ", b"100755 ")):
                        return Plan(True, "Changed path is not a regular file")
                    if name.endswith(".md"):
                        text = git(root, "show", f"{revision}:{name}").decode("utf-8")
                        if has_report_source(text):
                            return Plan(
                                True,
                                "Changed Markdown contains an executable report source",
                                (name,),
                            )
                        values.append(text)
                contents[name] = "\n\n".join(values)
        return classify(changes, contents)
    except (OSError, ValueError, UnicodeError, subprocess.CalledProcessError) as error:
        return Plan(True, f"Change discovery unavailable: {type(error).__name__}")


def github_push_plan(root: Path, payload: dict) -> Plan:
    repository = payload.get("repository")
    default = repository.get("default_branch") if isinstance(repository, dict) else None
    if (
        not isinstance(default, str)
        or default not in {"master", "main"}
        or payload.get("ref") != f"refs/heads/{default}"
    ):
        return Plan(True, "Only the configured master/main default branch may use push scoping")
    if any(payload.get(flag) is not False for flag in ("created", "deleted", "forced")):
        return Plan(True, "Created, deleted, forced, or unproven push requires full validation")
    before, after = payload.get("before"), payload.get("after")
    if (
        not isinstance(before, str)
        or not isinstance(after, str)
        or not re.fullmatch(r"[0-9a-f]{40}", before)
        or not re.fullmatch(r"[0-9a-f]{40}", after)
    ):
        return Plan(True, "Push endpoints are missing or not exact SHA-1 identifiers")
    return collect_plan(root, before, after, exact_range=True)


def github_plan(root: Path, event: str, payload: dict) -> Plan:
    if not isinstance(payload, dict):
        return Plan(True, "GitHub event payload is not an object")
    if event == "push":
        return github_push_plan(root, payload)
    if event != "pull_request":
        return Plan(True, f"{event or 'unknown'} event requires full validation")
    try:
        pr = payload["pull_request"]
        repository = payload.get("repository", {})
        if not isinstance(repository, dict):
            return Plan(True, "Pull request repository evidence is incomplete")
        default = repository.get("default_branch", "master")
        if (
            not isinstance(default, str)
            or default not in {"master", "main"}
            or pr["base"]["ref"] != default
        ):
            return Plan(True, "Non-default PR target requires full validation")
        return collect_plan(root, pr["base"]["sha"], pr["head"]["sha"])
    except (KeyError, TypeError):
        return Plan(True, "Pull request payload is incomplete")


def protected_ref(name: str) -> bool:
    branch = name.removeprefix("refs/heads/")
    return (
        name.startswith("refs/tags/")
        or branch in {"master", "main", "release"}
        or branch.startswith("release/")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--github", action="store_true")
    options = parser.parse_args()
    root = Path.cwd()
    if options.github:
        try:
            payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
            plan = github_plan(root, os.environ.get("GITHUB_EVENT_NAME", ""), payload)
        except (OSError, KeyError, ValueError):
            plan = Plan(True, "GitHub event evidence unavailable")
    else:
        plan = collect_plan(root, options.base or "", options.head)
    serialized = json.dumps(asdict(plan), ensure_ascii=True)
    if len(serialized) > 200_000:
        plan = Plan(True, "Change evidence exceeds output budget")
        serialized = json.dumps(asdict(plan))
    print(serialized)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a", encoding="utf-8") as stream:
            stream.write(f"full={str(plan.full).lower()}\n")
            stream.write(f"workflow_lint={str(plan.workflow_lint).lower()}\n")
            stream.write(f"plan={serialized}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
