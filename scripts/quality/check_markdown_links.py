"""Check repository-relative links in the repository documentation."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

MARKDOWN_LINK_PATTERN = re.compile(r"!?(?<!\\)\[[^\]]*\]\(([^)]+)\)")
SKIPPED_DIRECTORY_NAMES = frozenset(
    {
        ".agent-work",
        ".git",
        ".mypy_cache",
        ".ruff_cache",
        ".venv",
        "node_modules",
        "output",
        "reports",
        "research",
    },
)
REMOTE_SCHEMES = frozenset({"data", "ftp", "http", "https", "mailto", "tel"})


@dataclass(frozen=True)
class LinkIssue:
    markdown_path: Path
    line_number: int
    target: str
    message: str

    def format(self, root: Path) -> str:
        return f"{self.markdown_path.relative_to(root)}:{self.line_number}: {self.message}: {self.target}"


def iter_markdown_files(root: Path) -> list[Path]:
    candidates = [root / "README.md", *root.glob("docs/**/*.md"), *root.glob("tests/**/*.md")]
    return sorted(
        file_path
        for file_path in candidates
        if file_path.is_file()
        and not any(part in SKIPPED_DIRECTORY_NAMES for part in file_path.parts)
    )


def extract_target(raw_target: str) -> str | None:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1].strip()
    elif " " in target:
        target = target.split(maxsplit=1)[0]

    parsed = urlsplit(target)
    if parsed.scheme.lower() in REMOTE_SCHEMES or target.startswith("//"):
        return None
    if not parsed.path:
        return None
    return unquote(parsed.path)


def check_markdown_file(markdown_path: Path, root: Path) -> list[LinkIssue]:
    issues: list[LinkIssue] = []
    in_fenced_code_block = False
    for line_number, line in enumerate(
        markdown_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if line.lstrip().startswith(("```", "~~~")):
            in_fenced_code_block = not in_fenced_code_block
            continue
        if in_fenced_code_block:
            continue
        for match in MARKDOWN_LINK_PATTERN.finditer(line):
            target = extract_target(match.group(1))
            if target is None:
                continue
            resolved_target = (markdown_path.parent / target).resolve()
            if not resolved_target.is_relative_to(root) or not resolved_target.exists():
                issues.append(
                    LinkIssue(
                        markdown_path=markdown_path,
                        line_number=line_number,
                        target=match.group(1),
                        message="missing local Markdown link target",
                    ),
                )
    return issues


def check_markdown_links(root: Path) -> list[LinkIssue]:
    root = root.resolve()
    return [
        issue
        for markdown_path in iter_markdown_files(root)
        for issue in check_markdown_file(markdown_path, root)
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check local Markdown links without making network requests.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="repository root to scan (default: current directory)",
    )
    return parser.parse_args()


def main() -> int:
    root = parse_args().root.resolve()
    if not root.is_dir():
        print(f"Markdown link check root is not a directory: {root}", file=sys.stderr)
        return 2

    issues = check_markdown_links(root)
    if issues:
        for issue in issues:
            print(issue.format(root), file=sys.stderr)
        return 1

    print(f"Markdown link check passed ({len(iter_markdown_files(root))} file(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
