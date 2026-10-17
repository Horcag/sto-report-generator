"""Wordcraft uses the existing statistic contract on a disposable package."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree
from scripts.sto_post_build.constants import WORD_NS
from scripts.sto_post_build.wordcraft_statistics import prepare_docx, replace_paragraph_tokens


class WordcraftStatisticsTests(unittest.TestCase):
    def test_replaces_tokens_split_between_runs_without_flattening_formatting(self) -> None:
        paragraph = etree.fromstring(
            f'<w:p xmlns:w="{WORD_NS}"><w:r><w:rPr><w:b/></w:rPr><w:t>До {{</w:t>'
            "</w:r><w:r><w:t>{PAGES}</w:t></w:r><w:r><w:t>} после {{PAGES}}.</w:t>"
            "</w:r></w:p>"
        )
        self.assertTrue(replace_paragraph_tokens(paragraph, {"{{PAGES}}": "12"}))
        self.assertEqual("".join(paragraph.itertext()), "До 12 после 12.")
        self.assertIsNotNone(paragraph.find(f".//{{{WORD_NS}}}b"))

    def test_source_is_unchanged_and_package_parts_survive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.docx"
            destination = Path(directory) / "prepared.docx"
            document = (
                f'<w:document xmlns:w="{WORD_NS}"><w:body><w:p><w:r>'
                "<w:t>{{PAGES}} {{PAGES_WORD}} {{FIGURES}} {{TABLES}} "
                "{{SOURCES}} {{APPENDICES}}</w:t></w:r></w:p></w:body></w:document>"
            )
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/document.xml", document)
                archive.writestr("word/media/image.svg", "<svg/>")
                archive.writestr("opaque.bin", b"\x00\xff")
            original = source.read_bytes()
            warnings = prepare_docx(source, destination, 22)
            self.assertEqual(source.read_bytes(), original)
            with zipfile.ZipFile(destination) as archive:
                root = etree.fromstring(archive.read("word/document.xml"))
                text = "".join(root.itertext())
                self.assertIn("22 страницы", text)
                self.assertNotIn("{{", text)
                self.assertEqual(archive.read("opaque.bin"), b"\x00\xff")
            self.assertEqual(len(warnings), 1)
            self.assertIn("SVG", warnings[0])
            with self.assertRaisesRegex(ValueError, "separate DOCX"):
                prepare_docx(source, source, 22)
            with self.assertRaisesRegex(ValueError, "positive"):
                prepare_docx(source, destination, 0)

    def test_rejects_svg_bytes_mislabeled_as_png(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.docx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/document.xml", f'<w:document xmlns:w="{WORD_NS}"/>')
                archive.writestr("word/media/broken.png", "<svg/>")
            with self.assertRaisesRegex(ValueError, "invalid PNG"):
                prepare_docx(source, Path(directory) / "prepared.docx", 1)


if __name__ == "__main__":
    unittest.main()
