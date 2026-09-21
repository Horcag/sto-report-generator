#!/usr/bin/env python3
"""Check source-file sizes against the repository's shrinking debt baseline."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.quality.file_size_policy import (
    EXIT_CONFIGURATION_ERROR,
    BaselineUpdateError,
    PolicyConfigurationError,
    PolicyResult,
    Thresholds,
    build_reduced_baseline,
    discover_source_files,
    evaluate_file_sizes,
    load_baseline,
    load_config,
    write_baseline,
)


def _inside(root: Path, path: Path) -> Path:
    candidate = path if path.is_absolute() else root / path
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise PolicyConfigurationError(f"Path escapes repository: {path}") from error
    return resolved


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--config", type=Path, default=Path("quality/file-size-policy.json"))
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("--update-baseline", action="store_true")
    return parser


def _report(result: PolicyResult, scanned: int, thresholds: Thresholds, output_format: str) -> str:
    if output_format == "json":
        return json.dumps(
            {
                "schema_version": 1,
                "measurement": "physical_lines_including_blanks_and_comments",
                "thresholds": asdict(thresholds),
                "summary": result.summary(scanned),
                "findings": [asdict(item) for item in result.findings],
                "exit_code": result.exit_code,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    lines = [
        f"[{item.severity.upper()}][{'BLOCK' if item.blocking else 'INFO'}] {item.path}: {item.lines} lines"
        + (f", baseline={item.baseline_lines}" if item.baseline_lines is not None else "")
        + f" - {item.message}"
        for item in result.findings
    ]
    summary = result.summary(scanned)
    lines.append(
        f"File-size policy: scanned={scanned}, findings={summary['findings']}, blocking={summary['blocking']}, exit={result.exit_code}"
    )
    return "\n".join(lines)


def _error(message: str, exit_code: int, output_format: str) -> str:
    if output_format == "json":
        return json.dumps(
            {"schema_version": 1, "exit_code": exit_code, "error": message},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    return message


def run(arguments: Sequence[str] | None = None) -> int:
    options = _parser().parse_args(arguments)
    try:
        root = options.root.resolve()
        config = load_config(_inside(root, options.config))
        baseline_path = _inside(root, Path(config.baseline_path))
        files = discover_source_files(
            root,
            source_roots=config.source_roots,
            extensions=config.extensions,
            excluded_globs=config.excluded_globs,
        )
        baseline = load_baseline(baseline_path)
        reduced = build_reduced_baseline(files, baseline=baseline, thresholds=config.thresholds)
        if options.update_baseline:
            write_baseline(baseline_path, reduced, config.thresholds)
            baseline = reduced
        result = evaluate_file_sizes(files, baseline=baseline, thresholds=config.thresholds)
        print(_report(result, len(files), config.thresholds, options.format))
        return result.exit_code
    except BaselineUpdateError as error:
        print(
            _error(f"File-size baseline update rejected: {error}", error.exit_code, options.format),
            file=sys.stderr if options.format == "text" else sys.stdout,
        )
        return error.exit_code
    except (OSError, UnicodeError, json.JSONDecodeError, PolicyConfigurationError) as error:
        print(
            _error(
                f"File-size policy configuration error: {error}",
                EXIT_CONFIGURATION_ERROR,
                options.format,
            ),
            file=sys.stderr if options.format == "text" else sys.stdout,
        )
        return EXIT_CONFIGURATION_ERROR


if __name__ == "__main__":
    raise SystemExit(run())
