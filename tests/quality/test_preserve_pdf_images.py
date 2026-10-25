import importlib.util
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from scripts.quality.preserve_pdf_images import preserve_images
from tests.quality.test_inspect_pdf_images import make_docx, png

HAS_PYMUPDF = importlib.util.find_spec("pymupdf") is not None


@unittest.skipUnless(HAS_PYMUPDF, "optional PyMuPDF: run uv run --with pymupdf python -m unittest")
class PreservePdfImagesTests(unittest.TestCase):
    def setUp(self):
        import pymupdf

        self.mupdf = pymupdf
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name)
        self.docx = self.directory / "source.docx"
        self.pdf = self.directory / "degraded.pdf"
        self.output = self.directory / "restored.pdf"
        make_docx(self.docx)

    def update_docx(self, updates):
        with ZipFile(self.docx) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        contents.update(updates)
        with ZipFile(self.docx, "w") as archive:
            for name, data in contents.items():
                archive.writestr(name, data)

    def make_pdf(self, data=None, *, count=1):
        if data is None:
            source = self.mupdf.Pixmap(png())
            data = self.mupdf.Pixmap(source, 24, 12).tobytes("png")
        with self.mupdf.open() as document:
            for number in range(count):
                page = document.new_page(width=400, height=500)
                page.insert_text((30, 20), f"Page {number + 1}: existing text")
                page.insert_image(self.mupdf.Rect(30, 40, 102, 76), stream=data)
            if not count:
                page = document.new_page(width=400, height=500)
                page.insert_text((30, 20), "A report without raster images")
            document.save(self.pdf)

    def test_degraded_raster_restored_to_exact_source_pixels(self):
        self.make_pdf()
        with self.mupdf.open(self.pdf) as degraded:
            self.assertEqual(degraded[0].get_image_info()[0]["width"], 24)

        receipt = preserve_images(self.docx, self.pdf, self.output)

        self.assertEqual(receipt["status"], "originalPixelsVerified")
        self.assertEqual(receipt["replaced_image_objects"], 1)
        self.assertEqual(receipt["inspection"]["status"], "retained")
        with self.mupdf.open(self.output) as restored:
            info = restored[0].get_image_info(xrefs=True)[0]
            actual = self.mupdf.Pixmap(restored, info["xref"])
            expected = self.mupdf.Pixmap(png())
            self.assertEqual((actual.width, actual.height), (48, 24))
            self.assertEqual(actual.samples, expected.samples)

    def test_text_words_page_geometry_and_image_placement_are_unchanged(self):
        self.make_pdf()
        with self.mupdf.open(self.pdf) as source:
            source_geometry = [
                (tuple(page.rect), tuple(page.mediabox), tuple(page.cropbox), page.rotation)
                for page in source
            ]
            source_words = [page.get_text("words") for page in source]
            source_image_boxes = [
                [item["bbox"] for item in page.get_image_info()] for page in source
            ]
        before = self.pdf.read_bytes()

        receipt = preserve_images(self.docx, self.pdf, self.output)

        self.assertTrue(receipt["text_and_page_geometry_preserved"])
        self.assertEqual(self.pdf.read_bytes(), before)
        with self.mupdf.open(self.output) as restored:
            self.assertEqual(
                [
                    (tuple(page.rect), tuple(page.mediabox), tuple(page.cropbox), page.rotation)
                    for page in restored
                ],
                source_geometry,
            )
            self.assertEqual([page.get_text("words") for page in restored], source_words)
            self.assertEqual(
                [[item["bbox"] for item in page.get_image_info()] for page in restored],
                source_image_boxes,
            )

    def test_unrelated_image_with_matching_dimensions_refused_without_output(self):
        image = self.mupdf.Pixmap(png())
        image.invert_irect()
        self.make_pdf(image.tobytes("png"))

        with self.assertRaisesRegex(ValueError, "identity uncertain"):
            preserve_images(self.docx, self.pdf, self.output)

        self.assertFalse(self.output.exists())

    def make_two_source_docx(self):
        make_docx(self.docx, count=2)
        with ZipFile(self.docx) as archive:
            document = archive.read("word/document.xml").decode()
            relationships = archive.read("word/_rels/document.xml.rels").decode()
        # Same decoded content, distinct media bytes: identity alone cannot allow
        # one PDF object to stand for two different original encoded sources.
        second_png = png() + b"different media bytes"
        first, second = document.split('r:embed="rId1"', 1)
        second = second.replace('r:embed="rId1"', 'r:embed="rId2"', 1)
        document = first + 'r:embed="rId1"' + second
        relationships = relationships.replace(
            "</Relationships>",
            '<Relationship Id="rId2" Target="media/second.png" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>'
            "</Relationships>",
        )
        self.update_docx(
            {
                "word/document.xml": document.encode(),
                "word/_rels/document.xml.rels": relationships.encode(),
                "word/media/second.png": second_png,
            }
        )

    def test_shared_pdf_xref_mapping_to_different_sources_is_refused(self):
        self.make_two_source_docx()
        self.make_pdf(count=2)
        with self.mupdf.open(self.pdf) as source:
            xrefs = [page.get_image_info(xrefs=True)[0]["xref"] for page in source]
            self.assertEqual(xrefs[0], xrefs[1])

        with self.assertRaisesRegex(ValueError, "shared PDF image|Ambiguous PDF image identity"):
            preserve_images(self.docx, self.pdf, self.output)

        self.assertFalse(self.output.exists())

    def test_ambiguous_same_visual_sources_with_different_pdf_xrefs_are_refused(self):
        self.make_two_source_docx()
        with ZipFile(self.docx) as archive:
            left = archive.read("word/media/image.png")
            right = archive.read("word/media/second.png")
        self.assertNotEqual(left, right)
        self.assertEqual(self.mupdf.Pixmap(left).samples, self.mupdf.Pixmap(right).samples)
        # One changed pixel keeps both PDF objects visually near-identical while
        # ensuring the PDF library reports two independently addressable xrefs.
        changed = self.mupdf.Pixmap(left)
        changed.set_pixel(0, 0, (1, 0, 90))
        with self.mupdf.open() as document:
            for data in [left, changed.tobytes("png")]:
                page = document.new_page()
                page.insert_image(self.mupdf.Rect(30, 40, 102, 76), stream=data)
            document.save(self.pdf)
        with self.mupdf.open(self.pdf) as document:
            xrefs = [page.get_image_info(xrefs=True)[0]["xref"] for page in document]
            self.assertNotEqual(xrefs[0], xrefs[1])

        with self.assertRaisesRegex(ValueError, "Ambiguous PDF image identity"):
            preserve_images(self.docx, self.pdf, self.output)

        self.assertFalse(self.output.exists())

    def test_alpha_source_is_refused_without_output(self):
        image = self.mupdf.Pixmap(self.mupdf.Pixmap(png()), 1)
        image.set_alpha(bytes([128] * (image.width * image.height)))
        data = image.tobytes("png")
        self.update_docx({"word/media/image.png": data})
        self.make_pdf(data)

        with self.assertRaisesRegex(ValueError, "opaque RGB"):
            preserve_images(self.docx, self.pdf, self.output)

        self.assertFalse(self.output.exists())

    def test_cropped_source_is_refused_without_output(self):
        make_docx(self.docx, crop='<a:srcRect l="1000"/>')
        self.make_pdf()

        with self.assertRaisesRegex(ValueError, "cannot be verified"):
            preserve_images(self.docx, self.pdf, self.output)

        self.assertFalse(self.output.exists())

    def test_report_without_images_keeps_text_and_page_geometry(self):
        make_docx(self.docx, count=0)
        self.make_pdf(count=0)
        receipt = preserve_images(self.docx, self.pdf, self.output)
        self.assertEqual(receipt["replaced_image_objects"], 0)
        self.assertTrue(receipt["text_and_page_geometry_preserved"])
        with self.mupdf.open(self.pdf) as original, self.mupdf.open(self.output) as restored:
            self.assertEqual(original[0].get_text(), restored[0].get_text())
            self.assertEqual(original[0].rect, restored[0].rect)


if __name__ == "__main__":
    unittest.main()
