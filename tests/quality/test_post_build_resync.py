import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from scripts.sto_post_build.models import DocumentCounts, WordPostBuildResult
from scripts.sto_post_build.orchestrator import post_build


class PostBuildResyncTests(unittest.TestCase):
    def run_case(self, xml_changed=0, pdf_pages=140, legacy=False):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            docx = Path(directory) / "report.docx"
            text = "Отчет по практике содержит 1 страницу и 2 источника." if legacy else "Report"
            with ZipFile(docx, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/'
                    'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'
                    + text
                    + "</w:t></w:r></w:p></w:body></w:document>",
                )
            values = {
                "replace_formulas_from_markdown": 0,
                "normalize_docx_xml_layout": 0,
                "get_counts_from_docx": DocumentCounts(38, 52, 9),
                "run_word_post_build": WordPostBuildResult(140, 52, 38, 0, 0, "report.pdf"),
                "normalize_front_matter_table_geometry": xml_changed,
                "clear_dirty_fields": 3,
                "count_pdf_pages": pdf_pages,
                "export_docx_to_pdf": "report.pdf",
                "resync_docx_page_count_from_pdf": (pdf_pages, "report.pdf"),
                "assert_no_statistic_placeholders": None,
            }
            mocks = {
                name: stack.enter_context(
                    patch("scripts.sto_post_build.orchestrator." + name, return_value=value)
                )
                for name, value in values.items()
            }
            result = post_build(docx)
            return result, mocks

    def test_matching_saved_layout_skips_duplicate_native_cycle(self):
        result, mocks = self.run_case()
        self.assertEqual(result.pages, 140)
        mocks["resync_docx_page_count_from_pdf"].assert_not_called()
        mocks["export_docx_to_pdf"].assert_not_called()
        mocks["run_word_post_build"].assert_called_once()

    def test_post_native_geometry_still_exports_and_resyncs(self):
        _, mocks = self.run_case(xml_changed=1)
        mocks["resync_docx_page_count_from_pdf"].assert_called_once()
        mocks["export_docx_to_pdf"].assert_called_once()

    def test_pdf_mismatch_retains_resync(self):
        _, mocks = self.run_case(pdf_pages=141)
        mocks["resync_docx_page_count_from_pdf"].assert_called_once()

    def test_legacy_plain_text_page_count_retains_resync(self):
        _, mocks = self.run_case(legacy=True)
        mocks["resync_docx_page_count_from_pdf"].assert_called_once()


if __name__ == "__main__":
    unittest.main()
