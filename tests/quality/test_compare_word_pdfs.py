import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.compare_word_pdfs import check_context, compare_pages, compare_pdfs


def pgm(path: Path, pixels: bytes) -> None:
    path.write_bytes(b"P5\n2 2\n255\n" + pixels)


class VisualComparisonTests(unittest.TestCase):
    def test_changed_pixel_and_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pgm(root / "a.pgm", bytes([0, 0, 0, 0]))
            pgm(root / "b.pgm", bytes([0, 0, 0, 20]))
            self.assertEqual(
                compare_pages(root / "a.pgm", root / "b.pgm", 0)["bounds"], [1, 1, 1, 1]
            )
            self.assertEqual(compare_pages(root / "a.pgm", root / "b.pgm", 20)["changedPixels"], 0)

    def test_context_mismatch_rejected(self) -> None:
        left = {
            "sourceSha256": "same",
            "wordVersion": "16",
            "wordBuild": "1",
            "fontFingerprint": "font",
            "printer": "A",
            "dpi": 150,
            "anchors": ["figure-1"],
        }
        right = {**left, "printer": "B"}
        with self.assertRaisesRegex(ValueError, "printer"):
            check_context(left, right)

    def test_controlled_pdf_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pdfs = [root / "a.pdf", root / "b.pdf"]
            manifests = [root / "a.json", root / "b.json"]
            for pdf, manifest in zip(pdfs, manifests, strict=True):
                pdf.write_bytes(b"%PDF-1.4\ncontrolled fixture\n")
                manifest.write_text(
                    json.dumps(
                        {
                            "sourceSha256": "fixture-source-hash",
                            "wordVersion": "16.0",
                            "wordBuild": "16.0.1",
                            "fontFingerprint": "installed-fonts-hash",
                            "printer": "same printer",
                            "dpi": 150,
                            "anchors": ["heading:fixture"],
                            "pdfSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                        }
                    ),
                    encoding="utf-8",
                )

            def rasterize(command: list[str], **_kwargs: object) -> None:
                prefix = Path(command[-1])
                pgm(prefix.with_name(prefix.name + "-1.pgm"), bytes([0, 0, 0, 0]))

            with (
                patch("scripts.quality.compare_word_pdfs.shutil.which", return_value="pdftoppm"),
                patch("scripts.quality.compare_word_pdfs.subprocess.run", side_effect=rasterize),
            ):
                result = compare_pdfs(*pdfs, *manifests, 0, 0)
            self.assertTrue(result["passed"])
            self.assertEqual(len(result["pages"]), 1)


if __name__ == "__main__":
    unittest.main()
