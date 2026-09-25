import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.sto_post_build.docx_package import assert_no_statistic_placeholders
from scripts.sto_post_build.orchestrator import create_replacements
from scripts.sto_post_build.statistics import get_counts_from_docx


class ReferatStatisticReadinessTests(unittest.TestCase):
    def test_uses_post_build_count_forms(self) -> None:
        self.assertEqual(
            create_replacements(2, 3, 5, 2),
            {
                "{{FIGURES}}": "2 рисунка",
                "{{TABLES}}": "3 таблицы",
                "{{SOURCES}}": "5 источников",
                "{{APPENDICES}}": "2 приложения",
            },
        )

    def test_rejects_split_placeholder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            docx_path = Path(directory) / "report.docx"
            with zipfile.ZipFile(docx_path, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    "<w:body><w:p><w:r><w:t>{{PAG</w:t></w:r>"
                    "<w:r><w:t>ES}}</w:t></w:r></w:p></w:body></w:document>",
                )
            with self.assertRaisesRegex(RuntimeError, "{{PAGES}}"):
                assert_no_statistic_placeholders(docx_path)

    def test_accepts_rendered_statistic_line(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            docx_path = Path(directory) / "report.docx"
            with zipfile.ZipFile(docx_path, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    "<w:body><w:p><w:r><w:t>8 pages, 1 figure, 1 table, 1 source.</w:t>"
                    "</w:r></w:p></w:body></w:document>",
                )
            assert_no_statistic_placeholders(docx_path)

    def test_counts_word_renumbered_dotm_caption_styles(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            docx_path = Path(directory) / "report.docx"
            with zipfile.ZipFile(docx_path, "w") as archive:
                archive.writestr(
                    "word/styles.xml",
                    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:style w:styleId="-1"><w:name w:val="+№ - Название рисунка"/></w:style>'
                    '<w:style w:styleId="-3"><w:name w:val="+№ - Название таблицы"/></w:style>'
                    "</w:styles>",
                )
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:pPr><w:pStyle w:val="-1"/></w:pPr>'
                    "<w:r><w:t>Рисунок 1</w:t></w:r></w:p>"
                    '<w:p><w:pPr><w:pStyle w:val="-3"/></w:pPr>'
                    "<w:r><w:t>Таблица 1</w:t></w:r></w:p>"
                    "<w:p><w:r><w:t>Источник [1]</w:t></w:r></w:p>"
                    "</w:body></w:document>",
                )
            counts = get_counts_from_docx(docx_path)
            self.assertEqual((counts.figures, counts.tables, counts.sources), (1, 1, 1))

    def test_counts_semantic_appendix_headings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            docx_path = Path(directory) / "report.docx"
            with zipfile.ZipFile(docx_path, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:pPr><w:pStyle w:val="AppendixHeading"/></w:pPr>'
                    "<w:r><w:t>ПРИЛОЖЕНИЕ \u0410</w:t></w:r></w:p>"
                    '<w:p><w:pPr><w:pStyle w:val="AppendixHeading"/></w:pPr>'
                    "<w:r><w:t>ПРИЛОЖЕНИЕ Б</w:t></w:r></w:p>"
                    '<w:p><w:pPr><w:pStyle w:val="StructuralHeading"/></w:pPr>'
                    "<w:r><w:t>ПРИЛОЖЕНИЕ \u0412</w:t></w:r></w:p>"
                    "</w:body></w:document>",
                )
            self.assertEqual(get_counts_from_docx(docx_path).appendices, 3)


if __name__ == "__main__":
    unittest.main()
