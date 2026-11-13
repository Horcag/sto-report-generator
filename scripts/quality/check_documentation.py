"""Check changed documentation without compiling, rendering, or running code suites."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.quality.check_markdown_links import (
    check_markdown_file,
    check_markdown_links,
    extract_target,
    iter_markdown_files,
)


def validate_links(root: Path, files: list[str]) -> list[str]:
    issues = check_markdown_links(root)
    standard = set(iter_markdown_files(root))
    changed = {root / name for name in files}
    for path in changed:
        if path.suffix == ".md" and path.is_file() and path not in standard:
            issues.extend(check_markdown_file(path, root))
    # Deletion/rename must also find references in otherwise unchanged skills.
    deleted = {path.resolve() for path in changed if not path.exists()}
    if deleted:
        for path in (root / ".agents/skills").rglob("*.md"):
            for issue in check_markdown_file(path, root):
                target = extract_target(issue.target)
                if target is not None and (path.parent / target).resolve() in deleted:
                    issues.append(issue)
    return sorted({issue.format(root) for issue in issues})


def validate_csv(path: Path, root: Path) -> None:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.reader(stream, strict=True))
    if len(rows) < 2:
        raise ValueError(f"CSV requires a header and data records: {path}")
    header = rows[0]
    names = [name.strip().casefold() for name in header]
    if (
        not all(names)
        or len(set(names)) != len(names)
        or any(ord(character) < 32 for name in header for character in name)
    ):
        raise ValueError(f"CSV requires unique nonempty column names: {path}")
    for number, row in enumerate(rows[1:], 2):
        if len(row) != len(header) or not any(row):
            raise ValueError(f"Invalid CSV record width or empty record at {path}:{number}")
        for name, value in zip(names, row, strict=True):
            if any(ord(character) < 32 and character != "\n" for character in value):
                raise ValueError(f"Invalid CSV control character at {path}:{number}")
            if not value or not name.endswith(("_url", "_link", "_path")):
                continue
            target = urlsplit(value)
            if target.scheme in {"http", "https"} and target.netloc:
                continue
            local = (path.parent / value).resolve()
            if target.scheme or not local.is_relative_to(root) or not local.exists():
                raise ValueError(f"Invalid CSV resource link at {path}:{number}: {value}")


def run(args: list[str], root: Path) -> None:
    print("Documentation check: " + " ".join(args), flush=True)
    subprocess.run(args, cwd=root, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool-root", type=Path, default=Path.cwd())
    options = parser.parse_args()
    root = Path.cwd().resolve()
    tools = options.tool_root.resolve() / "node_modules"
    plan = json.loads(os.environ.get("CHANGE_SCOPE_JSON", "{}"))
    files = plan.get("files", [str(path.relative_to(root)) for path in iter_markdown_files(root)])
    existing = []
    for name in files:
        path = root / name
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"Documentation path escapes repository: {name}")
        if path.exists():
            if not path.is_file() or path.is_symlink():
                raise ValueError(f"Documentation must be a regular file: {name}")
            if path.suffix == ".csv":
                validate_csv(path, root)
            if path.suffix in {".md", ".json"}:
                existing.append(name)
    issues = validate_links(root, files)
    if issues:
        raise ValueError("\n".join(issues))
    formatted = [name for name in existing if name.endswith(".md")]
    if formatted:
        run(["node", str(tools / "prettier/bin/prettier.cjs"), "--check", "--", *formatted], root)
    frontmatter_script = r"""
const yaml = require(process.argv[1]);
const fs = require('node:fs');
for (const name of JSON.parse(fs.readFileSync(0, 'utf8'))) {
    const text = fs.readFileSync(name, 'utf8');
    if (!name.endsWith('.md')) { JSON.parse(text); continue; }
    if (!text.startsWith('---\n')) {
        if (name.endsWith('/SKILL.md')) throw new Error(`Missing skill frontmatter: ${name}`);
        continue;
    }
    const end = text.indexOf('\n---', 4);
    if (end < 0) throw new Error(`Unclosed frontmatter: ${name}`);
    const value = yaml.load(text.slice(4, end));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`Frontmatter must be a mapping: ${name}`);
    if (name.endsWith('/SKILL.md')) for (const field of ['name', 'description'])
        if (typeof value[field] !== 'string' || !value[field].trim())
            throw new Error(`Missing skill ${field}: ${name}`);
}
"""
    subprocess.run(
        ["node", "-e", frontmatter_script, str(tools / "js-yaml")],
        input=json.dumps(existing),
        text=True,
        cwd=root,
        check=True,
    )
    run([sys.executable, "scripts/quality/check_line_endings.py"], root)
    run(
        [
            "node",
            str(tools / "tsx/dist/cli.mjs"),
            "tests/package/run_pack_content_check.ts",
            "--content-only",
        ],
        root,
    )
    if plan.get("gallery"):
        run([sys.executable, "scripts/quality/report_gallery.py", "check"], root)
    print("Documentation gate passed: format, frontmatter, resource links, LF, package contents.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
