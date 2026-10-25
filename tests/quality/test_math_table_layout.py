import unittest
from typing import ClassVar

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS, TABLE_AFTER_SPACING_TWIPS, WORD_NS
from scripts.sto_post_build.xml_layout import (
    add_spacing_after_data_tables,
    is_data_table,
    is_math_layout_table,
)


class MathTableLayoutTests(unittest.TestCase):
    namespace: ClassVar[dict[str, str]] = {"w": WORD_NS, "m": MATH_NS}
    math = "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>"

    def document(self, table: str) -> etree._Element:
        return etree.fromstring(
            f'<w:document xmlns:w="{WORD_NS}" xmlns:m="{MATH_NS}"><w:body>'
            f"<w:p><w:r><w:t>Таблица 1</w:t></w:r></w:p>{table}"
            "<w:p><w:r><w:t>Explanation</w:t></w:r></w:p>"
            "</w:body></w:document>"
        )

    def layout_table(self, borders: str = "", rows: int = 1) -> str:
        row = (
            "<w:tr>"
            "<w:tc><w:p/></w:tc><w:tc><w:p><w:pPr>"
            '<w:jc w:val="center"/></w:pPr>'
            f"{self.math}</w:p></w:tc>"
            "<w:tc><w:p><w:r><w:t>(1)</w:t></w:r></w:p></w:tc>"
            "</w:tr>"
        )
        return f"<w:tbl><w:tblPr>{borders}</w:tblPr>{row * rows}</w:tbl>"

    def test_inline_math_data_table_gets_spacing(self) -> None:
        table = (
            f"<w:tbl><w:tr><w:tc><w:p>{self.math}</w:p></w:tc></w:tr>"
            "<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
        )
        document = self.document(table)
        table_element = document.find(f"{{{WORD_NS}}}body/{{{WORD_NS}}}tbl")
        self.assertTrue(is_data_table(table_element, self.namespace))
        self.assertEqual(add_spacing_after_data_tables(document), 1)
        self.assertEqual(
            document.xpath("./w:body/w:p[2]/w:pPr/w:spacing/@w:before", namespaces=self.namespace),
            [TABLE_AFTER_SPACING_TWIPS],
        )
        self.assertEqual(
            "".join(document.xpath("./w:body/w:p[2]//w:t/text()", namespaces=self.namespace)),
            "Explanation",
        )

    def test_existing_empty_paragraph_is_preserved(self) -> None:
        document = self.document("<w:tbl/><w:p/>")
        before = etree.tostring(document)
        self.assertEqual(add_spacing_after_data_tables(document), 0)
        self.assertEqual(etree.tostring(document), before)

    def test_display_wrappers_do_not_get_data_table_spacing(self) -> None:
        for borders in (
            "",
            '<w:tblBorders><w:top w:val="none"/><w:bottom w:val="nil"/></w:tblBorders>',
        ):
            with self.subTest(borders=borders):
                document = self.document(self.layout_table(borders))
                table = document.find(f"{{{WORD_NS}}}body/{{{WORD_NS}}}tbl")
                self.assertTrue(is_math_layout_table(table, self.namespace))
                self.assertEqual(add_spacing_after_data_tables(document), 0)

    def test_word_style_remap_preserves_display_classification(self) -> None:
        table = self.layout_table().replace("<w:pPr>", '<w:pPr><w:pStyle w:val="a42"/>')
        document = self.document(table)
        self.assertEqual(add_spacing_after_data_tables(document), 0)

    def test_named_formula_alignment_survives_word_removal_of_direct_jc(self) -> None:
        for style in ("Formula", "MTDisplayEquation"):
            with self.subTest(style=style):
                table = self.layout_table().replace(
                    '<w:jc w:val="center"/>', f'<w:pStyle w:val="{style}"/>'
                )
                document = self.document(table)
                self.assertEqual(add_spacing_after_data_tables(document), 0)
                wrong = self.document(table.replace("</w:pPr>", '<w:jc w:val="left"/></w:pPr>'))
                self.assertEqual(add_spacing_after_data_tables(wrong), 1)

    def test_remapped_formula_alignment_resolves_the_saved_style_graph(self) -> None:
        table = self.layout_table().replace(
            '<w:jc w:val="center"/>', '<w:pStyle w:val="equation-remapped"/>'
        )
        styles = etree.fromstring(
            f'<w:styles xmlns:w="{WORD_NS}"><w:style w:styleId="equation-remapped"><w:basedOn w:val="equation-parent"/></w:style><w:style w:styleId="equation-parent"><w:pPr><w:jc w:val="center"/></w:pPr></w:style></w:styles>'
        )
        self.assertEqual(add_spacing_after_data_tables(self.document(table), styles), 0)

    def test_supplied_style_without_alignment_does_not_use_name_fallback(self) -> None:
        table = self.layout_table().replace('<w:jc w:val="center"/>', '<w:pStyle w:val="Formula"/>')
        styles = etree.fromstring(
            f'<w:styles xmlns:w="{WORD_NS}"><w:style w:styleId="Formula"><w:pPr/></w:style></w:styles>'
        )
        self.assertEqual(add_spacing_after_data_tables(self.document(table), styles), 1)

    def test_centered_empty_paragraph_does_not_hide_left_aligned_math(self) -> None:
        table = (
            self.layout_table()
            .replace('<w:jc w:val="center"/>', '<w:jc w:val="left"/>')
            .replace(
                "<w:tc><w:p><w:pPr>",
                '<w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p><w:p><w:pPr>',
                1,
            )
        )
        self.assertEqual(add_spacing_after_data_tables(self.document(table)), 1)

    def test_word_merged_display_rows_do_not_get_data_table_spacing(self) -> None:
        document = self.document(self.layout_table(rows=2))
        table = document.find(f"{{{WORD_NS}}}body/{{{WORD_NS}}}tbl")
        self.assertTrue(is_math_layout_table(table, self.namespace))
        self.assertEqual(add_spacing_after_data_tables(document), 0)

    def test_mixed_formula_and_data_rows_are_data(self) -> None:
        table = self.layout_table().replace(
            "</w:tbl>",
            "<w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc>"
            f"<w:tc><w:p>{self.math}</w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>",
        )
        self.assertEqual(add_spacing_after_data_tables(self.document(table)), 1)

    def test_repeating_header_prevents_display_exemption(self) -> None:
        table = self.layout_table(rows=2).replace(
            "<w:tr>", "<w:tr><w:trPr><w:tblHeader/></w:trPr>", 1
        )
        self.assertEqual(add_spacing_after_data_tables(self.document(table)), 1)

    def test_bordered_math_table_is_data(self) -> None:
        document = self.document(
            self.layout_table('<w:tblBorders><w:top w:val="single"/></w:tblBorders>')
        )
        self.assertEqual(add_spacing_after_data_tables(document), 1)


if __name__ == "__main__":
    unittest.main()
