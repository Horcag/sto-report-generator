"""Keep Word page layout while restoring verified inline raster images from DOCX."""

import argparse
import importlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.quality.inspect_pdf_images import inspect_images, same_file, sha256


def thumbnail(image, mupdf):
    if image.colorspace != mupdf.csRGB:
        image = mupdf.Pixmap(mupdf.csRGB, image)
    if image.alpha:
        image = mupdf.Pixmap(image, 0)
    return mupdf.Pixmap(image, 64, 64).samples


def preserve_images(docx: Path, pdf: Path, output: Path) -> dict:
    if any(same_file(output, item) for item in (docx, pdf)):
        raise ValueError("restored PDF must differ from both inputs")
    mupdf = importlib.import_module("pymupdf")
    inspection = inspect_images(docx, pdf)
    if inspection["source_occurrences"] == inspection["pdf_occurrences"] == 0:
        if inspection["issues"] != ["no supported body raster occurrences to verify"]:
            raise ValueError(f"Unsupported image layout: {inspection['issues']}")
    elif inspection["status"] == "inconclusive":
        raise ValueError(
            "Original PDF quality cannot be verified for this image layout; "
            "inspect the image receipt or explicitly use print/screen quality."
        )
    replacements: dict[int, str] = {}
    identity = []
    pending = []
    with ZipFile(docx) as archive, mupdf.open(pdf) as document:
        page_geometry = [(tuple(p.rect), p.rotation) for p in document]
        text = [p.get_text() for p in document]
        candidates = {}
        for item in inspection["source_images"]:
            candidates[item["media_sha256"]] = thumbnail(
                mupdf.Pixmap(archive.read(item["media"])), mupdf
            )
        for case in inspection["cases"]:
            source, exported = case["source"], case["pdf"]
            xref = exported["xref"]
            if xref <= 0:
                raise ValueError("Inline PDF streams cannot be safely replaced")
            data = archive.read(source["media"])
            original = mupdf.Pixmap(data)
            # Do not change transparency, profiles or color conversions implicitly.
            if original.colorspace.n != 3 or (
                original.alpha and min(original.samples[3::4]) != 255
            ):
                raise ValueError("Original passthrough currently requires opaque RGB rasters")
            left = thumbnail(original, mupdf)
            right = thumbnail(mupdf.Pixmap(document, xref), mupdf)
            difference = sum(abs(a - b) for a, b in zip(left, right, strict=True)) / len(left)
            # Order and placement alone are not identity. Fail closed when the
            # independently decoded image content differs beyond resampling noise.
            if difference > 6:
                raise ValueError(
                    f"Image identity uncertain at occurrence {case['occurrence']}: {difference:.3f}"
                )
            for digest, candidate in candidates.items():
                if digest == source["media_sha256"]:
                    continue
                alternative = sum(abs(a - b) for a, b in zip(candidate, right, strict=True)) / len(
                    right
                )
                if alternative <= difference + 0.25:
                    raise ValueError("Ambiguous PDF image identity; multiple source images match")
            previous = replacements.get(xref)
            if previous is not None and previous != source["media_sha256"]:
                raise ValueError("A shared PDF image maps to different DOCX media")
            if previous is None:
                pending.append((exported["page"] - 1, xref, data))
                replacements[xref] = source["media_sha256"]
            identity.append(
                {
                    "occurrence": case["occurrence"],
                    "thumbnail_mean_error": difference,
                    "source_media_sha256": source["media_sha256"],
                }
            )
        for page, xref, data in pending:
            document[page].replace_image(xref, stream=data)
        output.parent.mkdir(parents=True, exist_ok=True)
        document.save(output, garbage=3, deflate=True)
    try:
        with mupdf.open(output) as restored, ZipFile(docx) as archive:
            if page_geometry != [(tuple(p.rect), p.rotation) for p in restored] or text != [
                p.get_text() for p in restored
            ]:
                raise ValueError("PDF text or page geometry changed during image restoration")
            after = inspect_images(docx, output)
            if inspection["cases"] and after["status"] != "retained":
                raise ValueError("Restored PDF still lost image pixels")
            for case in after["cases"]:
                original = mupdf.Pixmap(archive.read(case["source"]["media"]))
                actual = mupdf.Pixmap(restored, case["pdf"]["xref"])
                if original.alpha:
                    original = mupdf.Pixmap(original, 0)
                if actual.alpha:
                    actual = mupdf.Pixmap(actual, 0)
                if original.samples != actual.samples:
                    raise ValueError("Restored PDF pixels differ from DOCX raster pixels")
        return {
            "status": "originalPixelsVerified",
            "input_pdf_sha256": sha256(pdf),
            "pdf_sha256": sha256(output),
            "docx_sha256": sha256(docx),
            "replaced_image_objects": len(replacements),
            "identity_checks": identity,
            "text_and_page_geometry_preserved": True,
            "inspection": after,
        }
    except Exception:
        output.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("docx", type=Path)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.receipt.resolve() in {
            args.docx.resolve(),
            args.pdf.resolve(),
            args.output.resolve(),
        }:
            raise ValueError("receipt must differ from DOCX and PDF paths")
        result = preserve_images(args.docx, args.pdf, args.output)
        args.receipt.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", "utf-8")
    except Exception as error:
        print(f"Original PDF image preservation failed: {error}", file=sys.stderr)
        return 1
    print(f"PDF original pixels verified: {result['replaced_image_objects']} image objects")
    return 0


if __name__ == "__main__":
    sys.exit(main())
