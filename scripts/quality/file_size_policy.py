"""Domain logic for the repository file-size ratchet."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import cast

EXIT_OK = 0
EXIT_POLICY_ERROR = 1
EXIT_CRITICAL = 2
EXIT_CONFIGURATION_ERROR = 3


class PolicyConfigurationError(ValueError):
    """The policy configuration or baseline is malformed."""


class BaselineUpdateError(ValueError):
    """A baseline update would add or increase debt."""

    def __init__(self, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.exit_code = exit_code


@dataclass(frozen=True)
class Thresholds:
    warning_above: int
    error_above: int
    critical_above: int

    def validate(self) -> None:
        if not 0 < self.warning_above < self.error_above < self.critical_above:
            raise PolicyConfigurationError(
                "Expected 0 < warning_above < error_above < critical_above"
            )


@dataclass(frozen=True)
class PolicyConfig:
    source_roots: tuple[str, ...]
    extensions: tuple[str, ...]
    excluded_globs: tuple[str, ...]
    baseline_path: str
    thresholds: Thresholds


@dataclass(frozen=True)
class Finding:
    path: str
    lines: int
    severity: str
    status: str
    blocking: bool
    message: str
    baseline_lines: int | None = None


@dataclass(frozen=True)
class PolicyResult:
    findings: tuple[Finding, ...]
    exit_code: int

    def summary(self, scanned_files: int) -> dict[str, int]:
        return {
            "scanned_files": scanned_files,
            "findings": len(self.findings),
            "warnings": sum(item.severity == "warning" for item in self.findings),
            "errors": sum(item.severity == "error" for item in self.findings),
            "critical": sum(item.severity == "critical" for item in self.findings),
            "blocking": sum(item.blocking for item in self.findings),
        }


def count_physical_lines(path: Path) -> int:
    """Count physical lines, including blank lines and comments."""
    return len(path.read_text(encoding="utf-8-sig").splitlines())


def discover_source_files(
    repo_root: Path,
    *,
    source_roots: Sequence[str],
    extensions: Sequence[str],
    excluded_globs: Sequence[str],
) -> dict[str, int]:
    """Discover matching regular files inside the explicitly configured roots."""
    root = repo_root.resolve()
    found: dict[str, int] = {}
    for source_root in source_roots:
        directory = (root / source_root).resolve()
        try:
            directory.relative_to(root)
        except ValueError as error:
            raise PolicyConfigurationError(
                f"Source root escapes repository: {source_root}"
            ) from error
        if not directory.is_dir():
            continue
        for candidate in directory.rglob("*"):
            if (
                candidate.is_symlink()
                or not candidate.is_file()
                or candidate.suffix.lower() not in extensions
            ):
                continue
            relative = candidate.relative_to(root).as_posix()
            if any(PurePosixPath(relative).match(pattern) for pattern in excluded_globs):
                continue
            found[relative] = count_physical_lines(candidate)
    return dict(sorted(found.items()))


def _severity(lines: int, thresholds: Thresholds) -> str | None:
    if lines > thresholds.critical_above:
        return "critical"
    if lines > thresholds.error_above:
        return "error"
    if lines > thresholds.warning_above:
        return "warning"
    return None


def evaluate_file_sizes(
    files: Mapping[str, int], *, baseline: Mapping[str, int], thresholds: Thresholds
) -> PolicyResult:
    """Evaluate discovered files against the fixed debt baseline."""
    thresholds.validate()
    findings: list[Finding] = []
    for path, lines in sorted(files.items()):
        previous = baseline.get(path)
        if previous is None:
            severity = _severity(lines, thresholds)
            if severity:
                blocking = severity != "warning"
                findings.append(
                    Finding(
                        path,
                        lines,
                        severity,
                        "new-warning" if not blocking else "new-debt",
                        blocking,
                        f"New file has {lines} physical lines",
                    )
                )
        elif lines == previous:
            findings.append(
                Finding(
                    path,
                    lines,
                    _severity(lines, thresholds) or "warning",
                    "baselined",
                    False,
                    "Legacy debt is unchanged",
                    previous,
                )
            )
        elif lines > previous:
            severity = "critical" if lines > thresholds.critical_above else "error"
            findings.append(
                Finding(
                    path,
                    lines,
                    severity,
                    "regression",
                    True,
                    f"Legacy debt grew by {lines - previous} lines",
                    previous,
                )
            )
        else:
            findings.append(
                Finding(
                    path,
                    lines,
                    _severity(lines, thresholds) or "warning",
                    "baseline-reduced",
                    False,
                    f"Legacy debt was reduced by {previous - lines} lines",
                    previous,
                )
            )
    for path, previous in sorted(baseline.items()):
        if path not in files:
            findings.append(
                Finding(
                    path,
                    0,
                    "warning",
                    "baseline-removed",
                    False,
                    "Legacy debt file was removed or left the configured source roots",
                    previous,
                )
            )
    blocking_findings = [item for item in findings if item.blocking]
    exit_code = (
        EXIT_CRITICAL
        if any(item.severity == "critical" for item in blocking_findings)
        else EXIT_POLICY_ERROR
        if blocking_findings
        else EXIT_OK
    )
    return PolicyResult(tuple(findings), exit_code)


def build_reduced_baseline(
    files: Mapping[str, int], *, baseline: Mapping[str, int], thresholds: Thresholds
) -> dict[str, int]:
    """Retain only old caps that have not grown and remain above the warning threshold."""
    result = evaluate_file_sizes(files, baseline=baseline, thresholds=thresholds)
    unsafe = [item for item in result.findings if item.status in {"regression", "new-debt"}]
    if unsafe:
        exit_code = (
            EXIT_CRITICAL
            if any(item.severity == "critical" for item in unsafe)
            else EXIT_POLICY_ERROR
        )
        raise BaselineUpdateError(
            "Refusing to baseline new or increased debt: "
            + ", ".join(item.path for item in unsafe),
            exit_code,
        )
    return {
        path: files[path]
        for path in sorted(baseline)
        if files.get(path, 0) > thresholds.warning_above
    }


def _mapping(payload: object, context: str) -> Mapping[str, object]:
    if not isinstance(payload, dict):
        raise PolicyConfigurationError(f"{context} must be a JSON object")
    return payload


def _strings(payload: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = payload.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise PolicyConfigurationError(f"{key} must be an array of strings")
    return tuple(value)


def load_config(path: Path) -> PolicyConfig:
    payload = _mapping(json.loads(path.read_text(encoding="utf-8")), "config")
    if payload.get("schema_version") != 1:
        raise PolicyConfigurationError("Unsupported config schema_version")
    values = _mapping(payload.get("thresholds"), "thresholds")
    try:
        raw_thresholds = tuple(
            values[key] for key in ("warning_above", "error_above", "critical_above")
        )
        if not all(
            isinstance(value, int) and not isinstance(value, bool) for value in raw_thresholds
        ):
            raise TypeError("thresholds must be integers")
        thresholds = Thresholds(*cast(tuple[int, int, int], raw_thresholds))
    except (KeyError, TypeError, ValueError) as error:
        raise PolicyConfigurationError("Invalid thresholds") from error
    thresholds.validate()
    baseline_path = payload.get("baseline_path")
    if not isinstance(baseline_path, str) or not baseline_path:
        raise PolicyConfigurationError("baseline_path must be a non-empty string")
    return PolicyConfig(
        _strings(payload, "source_roots"),
        tuple(item.lower() for item in _strings(payload, "extensions")),
        _strings(payload, "excluded_globs"),
        baseline_path,
        thresholds,
    )


def load_baseline(path: Path) -> dict[str, int]:
    payload = _mapping(json.loads(path.read_text(encoding="utf-8")), "baseline")
    if payload.get("schema_version") != 1:
        raise PolicyConfigurationError("Unsupported baseline schema_version")
    entries = _mapping(payload.get("files"), "baseline.files")
    baseline: dict[str, int] = {}
    for raw_path, lines in entries.items():
        normalized = PurePosixPath(raw_path).as_posix() if isinstance(raw_path, str) else ""
        if normalized != raw_path or not isinstance(lines, int) or lines < 0:
            raise PolicyConfigurationError(
                "Baseline entries must map normalized paths to non-negative integers"
            )
        baseline[raw_path] = lines
    return dict(sorted(baseline.items()))


def write_baseline(path: Path, files: Mapping[str, int], thresholds: Thresholds) -> None:
    payload = {
        "schema_version": 1,
        "measurement": "physical_lines_including_blanks_and_comments",
        "thresholds": asdict(thresholds),
        "files": {
            name: lines for name, lines in sorted(files.items()) if lines > thresholds.warning_above
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)
