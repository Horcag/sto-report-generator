"""Compare a frozen DOCX corpus using verified Word and Wordcraft PDF receipts.

Usage: python scripts/quality/check_renderer_parity.py corpus.json --output parity.json
Optional PDF dependencies are loaded by compare_renderer_pdfs only after provenance checks.
"""

import argparse
import hashlib
import importlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

pdf_comparison = importlib.import_module(
    ".compare_renderer_pdfs" if __package__ else "compare_renderer_pdfs", package=__package__
)
compare_pdfs = pdf_comparison.compare_pdfs
sha256 = pdf_comparison.sha256


def read_json(path: Path, snapshots: dict | None = None) -> dict:
    content = path.read_bytes()
    data = json.loads(content)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object")
    if snapshots is not None:
        snapshots[path] = hashlib.sha256(content).hexdigest()
    return data


def resolve_path(value: object, parent: Path) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("artifact paths must be nonempty strings")
    if os.name != "nt" and (re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith("\\\\")):
        translated = subprocess.run(
            ["wslpath", "-u", value], capture_output=True, text=True, timeout=5, check=True
        )
        value = translated.stdout.strip()
        if not value.startswith("/"):
            raise ValueError("wslpath did not return an absolute artifact path")
    result = Path(value)
    return (result if result.is_absolute() else parent / result).resolve()


def verify_hash(path: Path, expected: object, label: str) -> str:
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
        raise ValueError(f"{label}: missing or invalid SHA256")
    actual = sha256(path)
    if actual != expected.lower():
        raise ValueError(f"{label}: SHA256 mismatch for {path}")
    return actual


def validate_output_path(output: Path | None, inputs: set[Path]) -> None:
    if output is None:
        return
    for source in inputs:
        if output.resolve() == source.resolve() or (
            output.exists() and source.exists() and output.samefile(source)
        ):
            raise ValueError(
                "--output must not overwrite an input JSON, DOCX or PDF (including aliases)"
            )


def load_cases(manifest: Path) -> list[dict]:
    cases = read_json(manifest).get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("corpus cases must be a nonempty array")
    identifiers = set()
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("each corpus case must be an object")
        identifier = case.get("id")
        if not isinstance(identifier, str) or not identifier.strip() or identifier in identifiers:
            raise ValueError("case ids must be nonempty and unique")
        identifiers.add(identifier)
        anchors = case.get("anchors")
        if not isinstance(anchors, list) or not all(
            isinstance(anchor, str) and anchor.strip() for anchor in anchors
        ):
            raise ValueError(f"{identifier}: anchors must be an array of nonempty strings")
        for key in ("sourceDocx", "wordManifest", "wordcraftManifest"):
            if not isinstance(case.get(key), str) or not case[key].strip():
                raise ValueError(f"{identifier}: {key} must be a nonempty path")
    return cases


def prepare_case(case: dict, parent: Path, inputs: set[Path]) -> dict:
    paths = {}
    records, errors = {}, []
    for key in ("sourceDocx", "wordManifest", "wordcraftManifest"):
        try:
            paths[key] = resolve_path(case[key], parent)
            inputs.add(paths[key])
        except Exception as exc:
            errors.append(f"{key}: {exc}")
    receipt_hashes: dict[Path, str] = {}
    for key in ("wordManifest", "wordcraftManifest"):
        if key not in paths:
            continue
        try:
            record = read_json(paths[key], receipt_hashes)
            records[key] = record
            if key == "wordManifest":
                values = []
                for field in ("inputDocx", "pdf"):
                    artifact = record.get(field)
                    if not isinstance(artifact, dict):
                        errors.append(f"{key}.{field}: expected an object")
                    else:
                        values.append(artifact.get("path"))
            else:
                values = [record.get("inputDocx"), record.get("outputPdf")]
            for value in values:
                try:
                    inputs.add(resolve_path(value, paths[key].parent))
                except Exception as exc:
                    errors.append(f"{key}: {exc}")
        except Exception as exc:
            errors.append(f"{key}: {exc}")
    if errors:
        raise ValueError("; ".join(errors))
    word, candidate = records["wordManifest"], records["wordcraftManifest"]
    return {
        "paths": paths,
        "receiptHashes": receipt_hashes,
        "word": word,
        "candidate": candidate,
        "wordPdf": resolve_path(word.get("pdf", {}).get("path"), paths["wordManifest"].parent),
        "candidatePdf": resolve_path(candidate.get("outputPdf"), paths["wordcraftManifest"].parent),
    }


def verify_case(prepared: dict) -> dict:
    paths, word, candidate = prepared["paths"], prepared["word"], prepared["candidate"]
    if word.get("status") != "accepted" or word.get("renderer") != "word-desktop-interactive":
        raise ValueError("Word baseline must have accepted status and Word desktop renderer")
    if (
        word.get("stablePageCount") is not True
        or word.get("capabilityChecks", {}).get("stablePageCount") is not True
    ):
        raise ValueError("Word baseline stablePageCount must be true")
    if word.get("execution", {}).get("processCleanupVerified") is not True:
        raise ValueError("Word baseline processCleanupVerified must be true")
    if (
        candidate.get("renderer") != "wordcraft"
        or not isinstance(candidate.get("version"), str)
        or not candidate["version"].strip()
    ):
        raise ValueError("candidate must identify the Wordcraft renderer and version")
    source = paths["sourceDocx"]
    source_hash = verify_hash(source, word.get("inputDocx", {}).get("sha256"), "Word input DOCX")
    verify_hash(source, candidate.get("sourceSha256"), "Wordcraft input DOCX")
    candidate_source = resolve_path(candidate.get("inputDocx"), paths["wordcraftManifest"].parent)
    verify_hash(candidate_source, source_hash, "Wordcraft recorded input DOCX")
    word_source = resolve_path(word.get("inputDocx", {}).get("path"), paths["wordManifest"].parent)
    verify_hash(word_source, source_hash, "Word recorded input DOCX")
    snapshots = {**prepared["receiptHashes"], source: source_hash}
    for filename, expected in prepared["receiptHashes"].items():
        verify_hash(filename, expected, "receipt changed after parsing")
    snapshots.update({word_source: source_hash, candidate_source: source_hash})
    for key, expected in (
        ("wordPdf", word.get("pdf", {}).get("sha256")),
        ("candidatePdf", candidate.get("pdfSha256")),
    ):
        filename = prepared[key]
        snapshots[filename] = verify_hash(filename, expected, key)
        with filename.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise ValueError(f"{filename}: invalid PDF signature")
    return snapshots


def case_warnings(candidate: dict) -> list[str]:
    warnings = candidate.get("warnings", [])
    if not isinstance(warnings, list) or not all(isinstance(item, str) for item in warnings):
        raise ValueError("Wordcraft warnings must be an array of strings")
    warnings = list(warnings)
    fonts = candidate.get("fonts")
    if fonts is None:
        warnings.append("Wordcraft font preflight evidence unavailable.")
    elif (
        not isinstance(fonts, dict)
        or not isinstance(fonts.get("missingFamilies"), list)
        or not all(isinstance(family, str) for family in fonts["missingFamilies"])
    ):
        raise ValueError("Wordcraft fonts.missingFamilies must be an array of strings")
    else:
        warnings.extend(
            f"Wordcraft unavailable font: {family}" for family in fonts["missingFamilies"]
        )
    return list(dict.fromkeys(warnings))


def run_corpus(manifest: Path, dpi: int = 96, output: Path | None = None) -> dict:
    if dpi not in (72, 96):
        raise ValueError("dpi must be 72 or 96")
    manifest = manifest.resolve()
    manifest_hash = sha256(manifest)
    cases = load_cases(manifest)
    inputs = {manifest}
    plans: list[dict | None] = []
    results: list[dict] = []
    # Discover every input before any comparison or output publication.
    for case in cases:
        result = {"id": case["id"], "anchors": case["anchors"]}
        results.append(result)
        try:
            prepared = prepare_case(case, manifest.parent, inputs)
            plans.append(prepared)
        except Exception as exc:
            result.update(status="provenance-failed", error=str(exc), observedParity=False)
            plans.append(None)
    validate_output_path(output, inputs)
    for case, plan, result in zip(cases, plans, results, strict=True):
        if plan is None:
            continue
        prepared = plan
        try:
            snapshots = verify_case(prepared)
            warnings = case_warnings(prepared["candidate"])
        except Exception as exc:
            result.update(status="provenance-failed", error=str(exc), observedParity=False)
            continue
        try:
            metrics = compare_pdfs(
                prepared["wordPdf"], prepared["candidatePdf"], case["anchors"], dpi
            )
        except Exception as exc:
            result.update(
                status="comparison-unavailable",
                error=str(exc),
                observedParity=False,
                warnings=warnings,
            )
            continue
        try:
            for filename, expected in snapshots.items():
                verify_hash(filename, expected, "artifact changed during comparison")
            for key, path_key in (("baseline", "wordPdf"), ("candidate", "candidatePdf")):
                if metrics[key]["sha256"] != snapshots[prepared[path_key]]:
                    raise ValueError(f"{key}: comparison inspected a different PDF SHA256")
        except Exception as exc:
            result.update(
                status="provenance-failed", error=str(exc), observedParity=False, warnings=warnings
            )
            continue
        result.update(
            status="compared",
            sourceSha256=snapshots[prepared["paths"]["sourceDocx"]],
            wordManifestSha256=snapshots[prepared["paths"]["wordManifest"]],
            wordcraftManifestSha256=snapshots[prepared["paths"]["wordcraftManifest"]],
            warnings=warnings,
            metrics=metrics,
            observedParity=metrics["observedParity"],
            reportedDocxPages={
                "word": prepared["word"].get("pageCountAfterReopen"),
                "wordcraft": prepared["candidate"].get("pageCount"),
            },
        )
    verify_hash(manifest, manifest_hash, "corpus manifest changed during comparison")
    validate_output_path(output, inputs)
    compared = [case["metrics"] for case in results if case["status"] == "compared"]
    pages = [page for metrics in compared for page in metrics["pages"]]
    return {
        "aggregateMetrics": {
            "baselinePdfPages": sum(metrics["baseline"]["pageCount"] for metrics in compared),
            "candidatePdfPages": sum(metrics["candidate"]["pageCount"] for metrics in compared),
            "unmatchedPages": sum(not page["matched"] for page in pages),
            "textDifferencePages": sum(
                page.get("text", {}).get("equal") is False for page in pages
            ),
            "geometryDifferencePages": sum(page.get("sameGeometry") is False for page in pages),
            "rasterChangedPixels": sum(
                page.get("raster", {}).get("changedPixels") or 0 for page in pages
            ),
        },
        "corpus": str(manifest),
        "corpusSha256": manifest_hash,
        "dpi": dpi,
        "cases": results,
        "observedParity": all(case["observedParity"] for case in results),
        "summary": {
            "cases": len(results),
            "compared": sum(case["status"] == "compared" for case in results),
            "provenanceFailed": sum(case["status"] == "provenance-failed" for case in results),
            "comparisonUnavailable": sum(
                case["status"] == "comparison-unavailable" for case in results
            ),
            "observedParity": sum(case["observedParity"] for case in results),
        },
        "limits": [
            "Observed parity covers this frozen corpus and measured PDF properties only; it does not certify renderer fidelity or STO compliance."
        ],
    }


def write_report(output: Path, report: str) -> None:
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=output.parent, prefix=".sto-parity-", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(report)
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--dpi", type=int, choices=(72, 96), default=96)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(arguments)
    try:
        result = run_corpus(args.manifest, args.dpi, args.output)
        report = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            write_report(args.output, report)
        else:
            print(report, end="")
    except Exception as exc:
        parser.exit(2, f"Renderer corpus comparison unavailable: {exc}\n")
    if result["summary"]["provenanceFailed"] or result["summary"]["comparisonUnavailable"]:
        return 2
    return 0 if result["observedParity"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
