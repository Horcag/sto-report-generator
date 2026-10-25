import hashlib
import importlib.util
import json
import struct
import tempfile
import unittest
import zlib
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from scripts.quality.inspect_pdf_images import inspect_images, main

HAS_PYMUPDF = importlib.util.find_spec("pymupdf") is not None


def png(width=48, height=24):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    rows = b"".join(
        b"\x00" + bytes(value for x in range(width) for value in (x % 256, y % 256, 90))
        for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def make_docx(
    path,
    *,
    count=1,
    crop="",
    transform="",
    inline="inline",
    svg=False,
    header=False,
    blip_children="",
    shape_properties="",
):
    drawing = f"""<w:r><w:drawing><wp:{inline}>
      <wp:extent cx="914400" cy="457200"/>
      <a:graphic><a:graphicData><pic:pic><pic:blipFill>
        <a:blip r:embed="rId1">{"<asvg:svgBlip/>" if svg else ""}{blip_children}</a:blip>{crop}
      </pic:blipFill><pic:spPr><a:xfrm {transform}/>{shape_properties}</pic:spPr></pic:pic>
      </a:graphicData></a:graphic>
    </wp:{inline}></w:drawing></w:r>"""
    document = f"""<w:document
      xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">
      <w:body><w:p>{drawing * count}</w:p></w:body></w:document>"""
    with ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr(
            "word/_rels/document.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="media/image.png" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>'
            "</Relationships>",
        )
        archive.writestr("word/media/image.png", png())
        if header:
            archive.writestr("word/header1.xml", document)


@unittest.skipUnless(HAS_PYMUPDF, "optional PyMuPDF: run uv run --with pymupdf python -m unittest")
class InspectPdfImagesTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        self.docx = self.directory / "source.docx"
        self.pdf = self.directory / "output.pdf"
        make_docx(self.docx)

    def make_pdf(self, *, width=48, height=24, count=1, rotate=0, display_width=72):
        import pymupdf

        with pymupdf.open() as document:
            for _ in range(count):
                page = document.new_page()
                page.insert_image(
                    pymupdf.Rect(30, 40, 30 + display_width, 76),
                    stream=png(width, height),
                    keep_proportion=False,
                    rotate=rotate,
                )
            if not count:
                document.new_page()
            document.save(self.pdf)

    def test_original_pixels_hashes_page_and_effective_dpi(self):
        self.make_pdf()
        receipt = inspect_images(self.docx, self.pdf)
        self.assertEqual(receipt["status"], "retained")
        self.assertEqual(receipt["docx_sha256"], hashlib.sha256(self.docx.read_bytes()).hexdigest())
        self.assertEqual(receipt["pdf_sha256"], hashlib.sha256(self.pdf.read_bytes()).hexdigest())
        case = receipt["cases"][0]
        self.assertEqual(case["source"]["pixels"], [48, 24])
        self.assertEqual(case["source"]["relationship_id"], "rId1")
        self.assertEqual(case["source"]["media_sha256"], hashlib.sha256(png()).hexdigest())
        self.assertEqual(case["pdf"]["pixels"], [48, 24])
        self.assertEqual(case["pdf"]["page"], 1)
        self.assertGreater(case["pdf"]["xref"], 0)
        self.assertEqual(case["pdf"]["effective_dpi"], [48, 48])
        self.assertEqual(case["pixel_ratio"], [1, 1])
        self.assertTrue(any("perceptual" in text for text in receipt["limitations"]))

    def test_loss_on_either_axis_fails_require_original(self):
        for width, height in [(24, 24), (48, 12), (24, 12)]:
            with self.subTest(width=width, height=height):
                self.make_pdf(width=width, height=height)
                self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "lost_pixels")
                self.assertEqual(self.run_cli(require=True), 1)

    def run_cli(self, *, require=False):
        receipt = self.directory / "receipt.json"
        arguments = [str(self.docx), str(self.pdf), "--output", str(receipt)]
        if require:
            arguments.append("--require-original")
        with redirect_stdout(StringIO()):
            return main(arguments)

    def test_cli_receipt_and_informational_mode(self):
        self.make_pdf(width=24, height=12)
        self.assertEqual(self.run_cli(), 0)
        receipt = json.loads((self.directory / "receipt.json").read_text())
        self.assertEqual(receipt["status"], "lost_pixels")
        self.make_pdf()
        self.assertEqual(self.run_cli(require=True), 0)

    def test_repeated_reference_counts_occurrences_across_pages(self):
        make_docx(self.docx, count=2)
        self.make_pdf(count=2)
        receipt = inspect_images(self.docx, self.pdf)
        self.assertEqual(receipt["status"], "retained")
        self.assertEqual([case["pdf"]["page"] for case in receipt["cases"]], [1, 2])

    def test_empty_or_zero_crop_is_supported(self):
        self.make_pdf()
        for crop in ["<a:srcRect/>", '<a:srcRect l="0" t="0" r="0" b="0"/>']:
            with self.subTest(crop=crop):
                make_docx(self.docx, crop=crop)
                self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "retained")

    def test_unsupported_source_variants_are_inconclusive(self):
        self.make_pdf()
        for options in [
            {"crop": '<a:srcRect l="1000"/>'},
            {"transform": 'rot="5400000"'},
            {"transform": 'flipH="true"'},
            {"inline": "anchor"},
            {"svg": True},
            {"header": True},
        ]:
            with self.subTest(options=options):
                make_docx(self.docx, **options)
                self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "inconclusive")
                self.assertEqual(self.run_cli(require=True), 1)

    def test_extra_or_missing_pdf_images_are_inconclusive(self):
        for count in [0, 2]:
            with self.subTest(count=count):
                self.make_pdf(count=count)
                result = inspect_images(self.docx, self.pdf)
                self.assertEqual(result["status"], "inconclusive")
                self.assertEqual(result["pdf_occurrences"], count)
                self.assertEqual(self.run_cli(require=True), 1)

    def test_picture_effects_and_nonrectangular_masks_are_inconclusive(self):
        self.make_pdf()
        for options in [
            {"shape_properties": '<a:effectLst><a:outerShdw blurRad="200"/></a:effectLst>'},
            {"shape_properties": "<a:effectDag><a:cont/></a:effectDag>"},
            {"shape_properties": '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'},
            {"blip_children": "<a:grayscl/>"},
            {
                "blip_children": '<a:extLst><a:ext uri="test"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"/></a:ext></a:extLst>'
            },
        ]:
            with self.subTest(options=options):
                make_docx(self.docx, **options)
                result = inspect_images(self.docx, self.pdf)
                self.assertEqual(result["status"], "inconclusive")
                self.assertEqual(self.run_cli(require=True), 1)

    def test_empty_effect_list_and_rectangular_geometry_are_supported(self):
        self.make_pdf()
        make_docx(
            self.docx,
            shape_properties='<a:effectLst/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
            blip_children='<a:extLst><a:ext uri="test"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst>',
        )
        self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "retained")

    def test_rotated_pdf_is_inconclusive(self):
        self.make_pdf(rotate=180)
        self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "inconclusive")

    def test_display_extent_mismatch_is_inconclusive(self):
        self.make_pdf(display_width=100)
        result = inspect_images(self.docx, self.pdf)
        self.assertEqual(result["status"], "inconclusive")
        self.assertIn("occurrence matching is uncertain", result["cases"][0]["issues"][0])

    def test_no_body_images_cannot_pass(self):
        make_docx(self.docx, count=0)
        self.make_pdf(count=0)
        self.assertEqual(inspect_images(self.docx, self.pdf)["status"], "inconclusive")
        self.assertEqual(self.run_cli(require=True), 1)


class OptionalDependencyTests(unittest.TestCase):
    def test_missing_pymupdf_is_actionable(self):
        with (
            patch(
                "scripts.quality.inspect_pdf_images.importlib.import_module",
                side_effect=ImportError,
            ),
            self.assertRaisesRegex(RuntimeError, "uv run --with pymupdf"),
        ):
            inspect_images(Path("source.docx"), Path("output.pdf"))


if __name__ == "__main__":
    unittest.main()
