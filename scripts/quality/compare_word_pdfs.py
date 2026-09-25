"""Compare two controlled Word PDF exports at a fixed raster DPI.

This is a visual regression aid, not a standards-conformance validator.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

CONTEXT_KEYS = (
    "sourceSha256",
    "wordVersion",
    "wordBuild",
    "fontFingerprint",
    "printer",
    "dpi",
    "anchors",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_manifest(path: Path, pdf: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    missing = [key for key in (*CONTEXT_KEYS, "pdfSha256") if not data.get(key)]
    if missing:
        raise ValueError(f"{path}: missing required fields: {', '.join(missing)}")
    if not isinstance(data["dpi"], int) or data["dpi"] < 72:
        raise ValueError(f"{path}: dpi must be an integer >= 72")
    if not isinstance(data["anchors"], list) or not all(
        isinstance(x, str) and x for x in data["anchors"]
    ):
        raise ValueError(f"{path}: anchors must be a nonempty list of strings")
    if not data["anchors"]:
        raise ValueError(f"{path}: at least one object/text anchor is required")
    if sha256(pdf) != data["pdfSha256"]:
        raise ValueError(f"{pdf}: SHA256 does not match {path}")
    return data


def check_context(baseline: dict, candidate: dict) -> None:
    different = [key for key in CONTEXT_KEYS if baseline[key] != candidate[key]]
    if different:
        raise ValueError(f"render contexts differ: {', '.join(different)}")


def read_pgm(path: Path) -> tuple[int, int, bytes]:
    # pdftoppm -gray emits binary PGM. Its header is small and ASCII.
    with path.open("rb") as stream:
        tokens: list[bytes] = []
        while len(tokens) < 4:
            line = stream.readline()
            if not line:
                raise ValueError(f"{path}: incomplete PGM header")
            if line.startswith(b"#"):
                continue
            tokens.extend(line.split())
        if len(tokens) != 4 or tokens[0] != b"P5" or tokens[3] != b"255":
            raise ValueError(f"{path}: expected 8-bit P5 PGM")
        width, height = int(tokens[1]), int(tokens[2])
        pixels = stream.read()
    if width <= 0 or height <= 0 or len(pixels) != width * height:
        raise ValueError(f"{path}: invalid pixel dimensions")
    return width, height, pixels


def compare_pages(baseline: Path, candidate: Path, tolerance: int) -> dict:
    width, height, left = read_pgm(baseline)
    other_width, other_height, right = read_pgm(candidate)
    if (width, height) != (other_width, other_height):
        raise ValueError(f"page size differs: {baseline.name} vs {candidate.name}")
    changed = 0
    bounds = [width, height, -1, -1]
    for index, (a, b) in enumerate(zip(left, right, strict=True)):
        if abs(a - b) <= tolerance:
            continue
        changed += 1
        x, y = index % width, index // width
        bounds = [min(bounds[0], x), min(bounds[1], y), max(bounds[2], x), max(bounds[3], y)]
    return {
        "width": width,
        "height": height,
        "changedPixels": changed,
        "changedFraction": changed / (width * height),
        "bounds": bounds if changed else None,
    }


def compare_pdfs(
    baseline_pdf: Path,
    candidate_pdf: Path,
    baseline_manifest: Path,
    candidate_manifest: Path,
    tolerance: int,
    max_changed_fraction: float,
) -> dict:
    baseline = read_manifest(baseline_manifest, baseline_pdf)
    candidate = read_manifest(candidate_manifest, candidate_pdf)
    check_context(baseline, candidate)
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise RuntimeError("pdftoppm (Poppler) is required to render PDF pages")
    with tempfile.TemporaryDirectory(prefix="sto-pdf-diff-") as temp:
        root = Path(temp)
        for pdf, name in ((baseline_pdf, "baseline"), (candidate_pdf, "candidate")):
            subprocess.run(
                [renderer, "-gray", "-r", str(baseline["dpi"]), str(pdf), str(root / name)],
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        left = sorted(root.glob("baseline-*.pgm"))
        right = sorted(root.glob("candidate-*.pgm"))
        if not left or len(left) != len(right):
            raise ValueError(f"page count differs or render failed: {len(left)} vs {len(right)}")
        pages = [compare_pages(a, b, tolerance) for a, b in zip(left, right, strict=True)]
    return {
        "baselinePdfSha256": baseline["pdfSha256"],
        "candidatePdfSha256": candidate["pdfSha256"],
        "context": {key: baseline[key] for key in CONTEXT_KEYS},
        "pixelTolerance": tolerance,
        "maxChangedFraction": max_changed_fraction,
        "pages": pages,
        "passed": all(page["changedFraction"] <= max_changed_fraction for page in pages),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline_pdf", type=Path)
    parser.add_argument("candidate_pdf", type=Path)
    parser.add_argument("baseline_manifest", type=Path)
    parser.add_argument("candidate_manifest", type=Path)
    parser.add_argument("--pixel-tolerance", type=int, default=0)
    parser.add_argument("--max-changed-fraction", type=float, default=0.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 0 <= args.pixel_tolerance <= 255 or not 0 <= args.max_changed_fraction <= 1:
        parser.error("tolerance must be 0..255 and max changed fraction must be 0..1")
    try:
        result = compare_pdfs(
            args.baseline_pdf,
            args.candidate_pdf,
            args.baseline_manifest,
            args.candidate_manifest,
            args.pixel_tolerance,
            args.max_changed_fraction,
        )
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        parser.exit(2, f"visual comparison unavailable: {exc}\n")
    report = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
