import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.sto_post_build.constants import MATH_NS, WORD_NS
from scripts.sto_post_build.docx_package import read_docx_part
from scripts.sto_post_build.process_ownership import record_word_application
from scripts.sto_post_build.word_automation import normalize_tables
from scripts.sto_post_build.word_tables import is_word_math_layout_table
from scripts.word_renderer_post_build import page_templates, restore_page_templates


class WordRendererTests(unittest.TestCase):
    def test_header_normalization_preserves_math_wrappers_but_not_data_tables(self):
        formula = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>'
        wrapper = f"<w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc>{formula}</w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>"

        def table(xml):
            return SimpleNamespace(
                Range=SimpleNamespace(
                    Start=1,
                    OMaths=SimpleNamespace(Count=1),
                    WordOpenXML=f'<root xmlns:w="{WORD_NS}" xmlns:m="{MATH_NS}"><w:document><w:body>{xml}</w:body></w:document></root>',
                ),
                Rows=Mock(),
            )

        math = table(wrapper)
        data = table(
            wrapper.replace(
                "<w:tc><w:p/></w:tc>", "<w:tc><w:p><w:r><w:t>Data</w:t></w:r></w:p></w:tc>", 1
            )
        )
        self.assertTrue(is_word_math_layout_table(math))
        self.assertFalse(is_word_math_layout_table(data))
        tables = Mock(Count=2, side_effect=lambda index: [math, data][index - 1])
        self.assertEqual(normalize_tables(SimpleNamespace(Tables=tables, Paragraphs=[])), 1)
        math.Rows.assert_not_called()
        self.assertTrue(data.Rows(1).HeadingFormat)

    def test_page_template_restoration_is_exact_and_rejects_ambiguity(self):
        with tempfile.TemporaryDirectory() as directory:
            docx = Path(directory) / "input.docx"

            def write(text):
                with zipfile.ZipFile(docx, "w") as archive:
                    archive.writestr(
                        "word/document.xml",
                        f'<w:document xmlns:w="{WORD_NS}"><w:body>{text}</w:body></w:document>',
                    )

            template = "Отчёт: {{PAGES}} {{PAGES_WORD}}, {{FIGURES}}."
            write(f"<w:p><w:r><w:t>{template}</w:t></w:r></w:p>")
            self.assertEqual(page_templates(str(docx)), [template])
            rendered = "<w:p><w:r><w:t>Отчёт: 7 страниц, 1 рисунок.</w:t></w:r></w:p>"
            write(rendered)
            replacements = {
                "{{PAGES}}": "7",
                "{{PAGES_WORD}}": "страниц",
                "{{FIGURES}}": "1 рисунок",
            }
            restore_page_templates(str(docx), [template], replacements)
            self.assertIn(template, read_docx_part(docx, "word/document.xml").decode())
            write(rendered * 2)
            before = docx.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "uniquely restore"):
                restore_page_templates(str(docx), [template], replacements)
            self.assertEqual(docx.read_bytes(), before)

    def test_missing_hwnd_uses_only_one_new_word_pid(self):
        module = SimpleNamespace(EnumProcesses=lambda: [1, 2, 3])
        with (
            patch.dict("sys.modules", {"win32process": module}),
            patch(
                "scripts.sto_post_build.process_ownership.process_identity",
                return_value={"executablePath": "WINWORD.EXE"},
            ),
            patch("scripts.sto_post_build.process_ownership.record_process") as record,
        ):
            record_word_application(SimpleNamespace(), {1, 2})
            record.assert_called_once_with(3, "post-build-word-3")
            module.EnumProcesses = lambda: [1, 2, 3, 4]
            with self.assertRaisesRegex(RuntimeError, "ambiguous"):
                record_word_application(SimpleNamespace(), {1, 2})


if __name__ == "__main__":
    unittest.main()
