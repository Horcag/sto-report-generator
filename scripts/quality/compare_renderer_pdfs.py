"""Measure cross-renderer PDF differences; this is not a fidelity or STO acceptance gate.

Usage: python compare_renderer_pdfs.py word.pdf other.pdf --anchor 'Introduction' --output diff.json
Optional runtime packages: pypdf, pypdfium2 and Pillow. No rasters are saved.
"""

import argparse
import hashlib
import importlib
import json
import unicodedata
from contextlib import ExitStack, closing
from difflib import SequenceMatcher
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def compare_text(left: str, right: str) -> dict:
    left, right = normalize_text(left), normalize_text(right)
    matcher = SequenceMatcher(None, left, right, autojunk=False)
    changes = [
        {
            "kind": tag,
            "baselineRange": [a, b],
            "candidateRange": [c, d],
            "baseline": left[a:b][:200],
            "candidate": right[c:d][:200],
        }
        for tag, a, b, c, d in matcher.get_opcodes()
        if tag != "equal"
    ]
    return {
        "equal": left == right,
        "similarity": matcher.ratio(),
        "baselineCharacters": len(left),
        "candidateCharacters": len(right),
        "differenceCount": len(changes),
        "differences": changes[:50],
        "differencesTruncated": len(changes) > 50,
    }


def resource_summary(page) -> dict:
    fonts, images, visited = set(), set(), set()

    def visit(resources) -> None:
        resources = resources.get_object()
        for font in (
            resources.get("/Font", {}).get_object().values() if "/Font" in resources else []
        ):
            font = font.get_object()
            fonts.add(str(font.get("/BaseFont", font.get("/Subtype", "unknown"))))
        objects = resources.get("/XObject")
        if objects is None:
            return
        for reference in objects.get_object().values():
            obj = reference.get_object()
            identity = id(obj)
            if identity in visited:
                continue
            visited.add(identity)
            if obj.get("/Subtype") == "/Image":
                images.add(identity)
            if "/Resources" in obj:
                visit(obj["/Resources"])

    if "/Resources" in page:
        visit(page["/Resources"])
    return {"fonts": sorted(fonts), "imageResourceCount": len(images)}


def inspect_pdf(path: Path, pypdf) -> dict:
    with path.open("rb") as stream:
        reader = pypdf.PdfReader(stream, strict=True)
        if reader.is_encrypted:
            raise ValueError(f"{path}: encrypted PDFs are unsupported")
        pages = []
        for page in reader.pages:
            unit = float(page.get("/UserUnit", 1))
            pages.append(
                {
                    "widthPoints": float(page.mediabox.width) * unit,
                    "heightPoints": float(page.mediabox.height) * unit,
                    "rotationDegrees": page.rotation,
                    "text": page.extract_text() or "",
                    **resource_summary(page),
                }
            )
    return {"path": str(path), "sha256": sha256(path), "pageCount": len(pages), "pages": pages}


def find_anchors(page, anchors: list[str]) -> dict:
    text = page.get_textpage()
    result = {}
    try:
        for anchor in anchors:
            search = text.search(anchor, match_case=True)
            matches = []
            try:
                while (match := search.get_next()) is not None:
                    start, count = match
                    rectangles = text.count_rects(start, count)
                    matches.append(
                        {
                            "characterRange": [start, start + count],
                            "boundsPoints": [list(text.get_rect(i)) for i in range(rectangles)],
                        }
                    )
            finally:
                search.close()
            result[anchor] = matches
    finally:
        text.close()
    return result


def compare_rasters(left, right, image_chops, tolerance: int = 16) -> dict:
    result = {"baselineSize": list(left.size), "candidateSize": list(right.size)}
    if left.size != right.size:
        return {**result, "sameDimensions": False, "changedPixels": None, "changedFraction": None}
    difference = image_chops.difference(left, right)
    channels = difference.split()
    maximum = image_chops.lighter(image_chops.lighter(channels[0], channels[1]), channels[2])
    histogram = maximum.histogram()
    changed = sum(histogram[tolerance + 1 :])
    return {
        **result,
        "sameDimensions": True,
        "changedPixels": changed,
        "changedFraction": changed / (left.width * left.height),
    }


def inspect_visuals(
    paths: tuple[Path, Path], pages: list[dict], anchors: list[str], dpi: int
) -> dict:
    try:
        pdfium = importlib.import_module("pypdfium2")
        image_chops = importlib.import_module("PIL.ImageChops")
    except ImportError as exc:
        return {"available": False, "reason": str(exc)}
    with ExitStack() as stack:
        documents = [stack.enter_context(closing(pdfium.PdfDocument(str(path)))) for path in paths]
        for index, comparison in enumerate(pages):
            with ExitStack() as page_stack:
                images = []
                for side, document in zip(("baseline", "candidate"), documents, strict=True):
                    if index >= len(document):
                        continue
                    page = page_stack.enter_context(closing(document[index]))
                    comparison[side + "Anchors"] = find_anchors(page, anchors)
                    bitmap = page.render(scale=dpi / 72)
                    page_stack.callback(bitmap.close)
                    rendered = bitmap.to_pil()
                    page_stack.callback(rendered.close)
                    rgb = rendered.convert("RGB")
                    page_stack.callback(rgb.close)
                    images.append(rgb)
                if len(images) == 2:
                    comparison["raster"] = compare_rasters(images[0], images[1], image_chops)
    return {"available": True}


def compare_documents(baseline: dict, candidate: dict) -> list[dict]:
    pages = []
    for index in range(max(baseline["pageCount"], candidate["pageCount"])):
        left = baseline["pages"][index] if index < baseline["pageCount"] else None
        right = candidate["pages"][index] if index < candidate["pageCount"] else None
        page: dict = {"page": index + 1, "matched": left is not None and right is not None}
        if left is None or right is None:
            page["unmatchedSide"] = "candidate" if left is None else "baseline"
        else:
            page["text"] = compare_text(left["text"], right["text"])
            page["sameGeometry"] = all(
                left[key] == right[key]
                for key in ("widthPoints", "heightPoints", "rotationDegrees")
            )
            page["sameFontResources"] = left["fonts"] == right["fonts"]
            page["sameImageResourceCount"] = (
                left["imageResourceCount"] == right["imageResourceCount"]
            )
        pages.append(page)
    return pages


def observed_parity(pages: list[dict], visual_available: bool, anchors: list[str]) -> bool:
    return (
        bool(pages)
        and visual_available
        and all(
            page["matched"]
            and page["text"]["equal"]
            and page["sameGeometry"]
            and page["sameFontResources"]
            and page["sameImageResourceCount"]
            and page.get("raster", {}).get("changedFraction") == 0
            and all(
                page.get("baselineAnchors", {}).get(anchor)
                == page.get("candidateAnchors", {}).get(anchor)
                for anchor in anchors
            )
            for page in pages
        )
        and all(
            any(page.get("baselineAnchors", {}).get(anchor) for page in pages) for anchor in anchors
        )
    )


def compare_pdfs(baseline: Path, candidate: Path, anchors: list[str], dpi: int = 96) -> dict:
    if dpi not in (72, 96):
        raise ValueError("dpi must be 72 or 96")
    if any(not anchor.strip() for anchor in anchors):
        raise ValueError("anchors must be nonempty strings")
    try:
        pypdf = importlib.import_module("pypdf")
    except ImportError as exc:
        raise RuntimeError("PDF inspection unavailable: optional pypdf is required") from exc
    left, right = inspect_pdf(baseline, pypdf), inspect_pdf(candidate, pypdf)
    pages = compare_documents(left, right)
    visual = inspect_visuals((baseline, candidate), pages, anchors, dpi)
    parity = observed_parity(pages, visual["available"], anchors)
    for document in (left, right):
        for page in document["pages"]:
            page["normalizedCharacters"] = len(normalize_text(page.pop("text")))
    return {
        "baseline": left,
        "candidate": right,
        "pages": pages,
        "visualInspection": visual,
        "observedParity": parity,
        "methods": {
            "text": "pypdf extract_text; Unicode NFKC + whitespace folding; character SequenceMatcher, autojunk=False",
            "textDifferenceLimit": "first 50 spans, first 200 characters per side per span",
            "geometry": "pypdf MediaBox multiplied by UserUnit, plus page rotation",
            "resources": "pypdf font BaseFont names and unique image XObjects, recursively through Forms",
            "anchors": "PDFium literal case-sensitive search; rectangles in PDF page coordinates (left,bottom,right,top)",
            "raster": "PDFium RGB at fixed DPI; any channel difference > tolerance counts; paired pages streamed",
            "dpi": dpi,
            "pixelTolerance": 16,
        },
        "limits": [
            "Observed parity covers only these measurements; it does not certify renderer fidelity or STO compliance.",
            "Text extraction order and normalization may hide or introduce differences, including mathematical typography.",
            "Font/image resources can include unused objects; names/counts do not prove font or image fidelity. Inline images are excluded.",
            "Pages are paired by ordinal; reflow is not realigned. Unmatched pages force observedParity=false.",
            "Raster differences depend on PDFium and DPI; subpixel differences within tolerance are ignored.",
            "Anchors must exist in baseline and agree in page, character range and rectangles; missing anchors fail parity.",
        ],
    }


def validate_output_path(output: Path | None, inputs: tuple[Path, Path]) -> None:
    if output is None:
        return
    for source in inputs:
        if output.resolve() == source.resolve() or (
            output.exists() and source.exists() and output.samefile(source)
        ):
            raise ValueError("--output must not overwrite either input PDF (including aliases)")


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline_pdf", type=Path)
    parser.add_argument("candidate_pdf", type=Path)
    parser.add_argument("--anchor", action="append", default=[])
    parser.add_argument("--dpi", type=int, choices=(72, 96), default=96)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(arguments)
    if any(not value.strip() for value in args.anchor):
        parser.error("--anchor must be nonempty")
    try:
        validate_output_path(args.output, (args.baseline_pdf, args.candidate_pdf))
        result = compare_pdfs(args.baseline_pdf, args.candidate_pdf, args.anchor, args.dpi)
        report = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(report, encoding="utf-8")
        else:
            print(report, end="")
    except Exception as exc:
        parser.exit(2, f"PDF comparison unavailable: {exc}\n")
    return 0 if result["observedParity"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
