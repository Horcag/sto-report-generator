"""Compare DOCX body raster occurrences with displayed PDF image pixel dimensions.

Run with: uv run --with pymupdf python scripts/quality/inspect_pdf_images.py
    input.docx output.pdf --output receipt.json --require-original
"""

import argparse
import hashlib
import importlib
import json
import math
import posixpath
import sys
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

from defusedxml import ElementTree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
}
RASTERS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff"}
LIMITATIONS = [
    "Only body inline, uncropped, unrotated raster pictures are supported.",
    "Matching assumes DOCX body order equals PDF page and image occurrence order; "
    "dimensions and placement sizes do not prove image identity.",
    "Pixel counts do not certify perceptual quality, compression, colors, or original pixel values.",
    "PDF clipping, overlays, transparency and vector rendering are not visually certified.",
]


def same_file(left: Path, right: Path) -> bool:
    return left.resolve() == right.resolve() or (
        left.exists() and right.exists() and left.samefile(right)
    )


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def drawing_source(drawing: Any, relationships: dict, archive: ZipFile, mupdf: Any) -> dict:
    result: dict[str, Any] = {"issues": []}
    issues = result["issues"]
    inline = drawing.find("wp:inline", NS)
    if inline is None or len(drawing) != 1:
        issues.append("drawing is not a single inline picture")
    if len(drawing.findall(".//pic:pic", NS)) != 1:
        issues.append("drawing is not a single raster picture")
    blips = drawing.findall(".//a:blip", NS)
    if len(blips) != 1:
        issues.append("drawing does not contain exactly one raster reference")
        return result
    harmless_extensions = {
        f"{{{NS['a']}}}extLst",
        f"{{{NS['a']}}}ext",
        "{http://schemas.microsoft.com/office/drawing/2010/main}useLocalDpi",
    }
    for extension in blips[0].findall("a:extLst", NS):
        if any(node.tag not in harmless_extensions for node in extension.iter()):
            issues.append("unknown image-processing extension is unsupported")
    if any(child.tag != f"{{{NS['a']}}}extLst" for child in blips[0]):
        issues.append("picture color or transparency effects are unsupported")
    for effect in drawing.findall(".//a:effectLst", NS) + drawing.findall(".//a:effectDag", NS):
        if len(effect):
            issues.append("picture effects are unsupported")
    for geometry in drawing.findall(".//a:prstGeom", NS):
        if geometry.get("prst") != "rect":
            issues.append("nonrectangular picture geometry is unsupported")
    if drawing.findall(".//a:custGeom", NS):
        issues.append("custom picture geometry is unsupported")
    if any(node.tag.endswith("}svgBlip") for node in drawing.iter()):
        issues.append("SVG picture or SVG fallback is unsupported")
    for crop in drawing.findall(".//a:srcRect", NS):
        if any(float(value) != 0 for value in crop.attrib.values()):
            issues.append("cropped picture is unsupported")
    for transform in drawing.findall(".//a:xfrm", NS):
        if float(transform.get("rot", "0")) != 0 or any(
            transform.get(key, "0").lower() not in {"0", "false"} for key in ("flipH", "flipV")
        ):
            issues.append("rotated or flipped picture is unsupported")
    extent = inline.find("wp:extent", NS) if inline is not None else None
    if extent is None:
        issues.append("inline picture has no display extent")
    else:
        size = [int(extent.get(axis, "0")) / 12700 for axis in ("cx", "cy")]
        if min(size) <= 0:
            issues.append("inline picture has invalid display extent")
        else:
            result["display_pt"] = size
    relation_id = blips[0].get(f"{{{NS['r']}}}embed")
    result["relationship_id"] = relation_id
    relationship = relationships.get(relation_id)
    if relationship is None or relationship.get("TargetMode") == "External":
        issues.append("missing or external image relationship")
        return result
    if not relationship.get("Type", "").endswith("/image"):
        issues.append("relationship is not an image")
        return result
    target = relationship.get("Target", "")
    media = posixpath.normpath(posixpath.join("word", target))
    if target.startswith("/"):
        media = posixpath.normpath(target.lstrip("/"))
    result["media"] = media
    if not media.startswith("word/") or Path(media).suffix.lower() not in RASTERS:
        issues.append("unsupported image type or package location")
        return result
    try:
        data = archive.read(media)
        result["media_sha256"] = hashlib.sha256(data).hexdigest()
        image = mupdf.Pixmap(data)
        result["pixels"] = [image.width, image.height]
        if "display_pt" in result:
            result["effective_dpi"] = [
                pixels * 72 / points
                for pixels, points in zip(result["pixels"], result["display_pt"], strict=True)
            ]
    except (KeyError, RuntimeError, ValueError) as error:
        issues.append(f"cannot decode source raster: {error}")
    return result


def source_images(docx: Path, mupdf: Any) -> tuple[list[dict], list[str]]:
    issues = []
    with ZipFile(docx) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
        body = document.find("w:body", NS)
        if body is None:
            return [], ["DOCX has no document body"]
        relationships = {}
        if "word/_rels/document.xml.rels" in archive.namelist():
            relationships = {
                item.get("Id"): item
                for item in ElementTree.fromstring(archive.read("word/_rels/document.xml.rels"))
            }
        images = [
            drawing_source(item, relationships, archive, mupdf)
            for item in body.findall(".//w:drawing", NS)
        ]
        for name in archive.namelist():
            if not name.startswith("word/") or not name.endswith(".xml"):
                continue
            tree = ElementTree.fromstring(archive.read(name))
            if any(node.tag.endswith("}imagedata") for node in tree.iter()):
                issues.append(f"legacy VML images are unsupported: {name}")
            if name != "word/document.xml" and tree.findall(".//w:drawing", NS):
                issues.append(f"pictures outside document body are unsupported: {name}")
        if len(document.findall(".//w:drawing", NS)) != len(images):
            issues.append("drawings outside document body are unsupported")
    return images, issues


def displayed_images(pdf: Path, mupdf: Any) -> list[dict]:
    images = []
    with mupdf.open(pdf) as document:
        for page_number, page in enumerate(document, 1):
            for info in page.get_image_info(xrefs=True):
                a, b, c, d, _x, _y = info["transform"]
                size = [math.hypot(a, b), math.hypot(c, d)]
                issues = []
                if page.rotation or abs(b) > 0.001 or abs(c) > 0.001 or a <= 0 or d <= 0:
                    issues.append("rotated, flipped or skewed PDF image is unsupported")
                if min(size) <= 0:
                    issues.append("PDF image has invalid display extent")
                if not page.rect.contains(mupdf.Rect(info["bbox"])):
                    issues.append("PDF image is not fully inside the visible page")
                pixels = [info["width"], info["height"]]
                images.append(
                    {
                        "page": page_number,
                        "image_order": info["number"],
                        "xref": info["xref"],
                        "pixels": pixels,
                        "display_pt": size,
                        "effective_dpi": [
                            px * 72 / pt if pt > 0 else None
                            for px, pt in zip(pixels, size, strict=True)
                        ],
                        "issues": issues,
                    }
                )
    return images


def inspect_images(docx: Path, pdf: Path) -> dict:
    try:
        mupdf = importlib.import_module("pymupdf")
    except ImportError as error:
        raise RuntimeError(
            "PyMuPDF is optional. Run: uv run --with pymupdf python "
            "scripts/quality/inspect_pdf_images.py <docx> <pdf> --output receipt.json"
        ) from error
    source, issues = source_images(docx, mupdf)
    displayed = displayed_images(pdf, mupdf)
    if not source:
        issues.append("no supported body raster occurrences to verify")
    if len(source) != len(displayed):
        issues.append("source and displayed PDF image occurrence counts differ")
    cases = []
    for index, (original, exported) in enumerate(zip(source, displayed, strict=False), 1):
        case_issues = [*original["issues"], *exported["issues"]]
        ratio = None
        if "pixels" in original:
            ratio = [
                out / src for src, out in zip(original["pixels"], exported["pixels"], strict=True)
            ]
        if "display_pt" in original and any(
            abs(src - out) > 1
            for src, out in zip(original["display_pt"], exported["display_pt"], strict=True)
        ):
            case_issues.append("display extent mismatch; occurrence matching is uncertain")
        status = "inconclusive"
        if not issues and not case_issues and ratio is not None:
            status = "retained" if min(ratio) >= 1 else "lost_pixels"
        cases.append(
            {
                "occurrence": index,
                "source": original,
                "pdf": exported,
                "pixel_ratio": ratio,
                "status": status,
                "issues": case_issues,
            }
        )
    if issues or any(case["status"] == "inconclusive" for case in cases):
        status = "inconclusive"
    else:
        status = "lost_pixels" if any(c["status"] == "lost_pixels" for c in cases) else "retained"
    return {
        "schema_version": 1,
        "status": status,
        "docx_sha256": sha256(docx),
        "pdf_sha256": sha256(pdf),
        "source_occurrences": len(source),
        "pdf_occurrences": len(displayed),
        "source_images": source,
        "pdf_images": displayed,
        "issues": issues,
        "cases": cases,
        "limitations": LIMITATIONS,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("docx", type=Path)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--require-original", action="store_true")
    args = parser.parse_args(argv)
    try:
        if any(same_file(args.output, item) for item in (args.docx, args.pdf)):
            raise ValueError("receipt output must differ from both input files")
        result = inspect_images(args.docx, args.pdf)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", "utf-8")
    except (OSError, BadZipFile, RuntimeError, ValueError, KeyError) as error:
        print(f"PDF image inspection failed: {error}", file=sys.stderr)
        return 2
    print(f"PDF image pixels: {result['status']}; receipt: {args.output}")
    return int(args.require_original and result["status"] != "retained")


if __name__ == "__main__":
    sys.exit(main())
