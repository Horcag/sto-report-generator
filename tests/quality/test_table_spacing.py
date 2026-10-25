import json
import unittest
from pathlib import Path

from lxml import etree
from scripts.sto_post_build.constants import WORD_NS
from scripts.sto_post_build.table_spacing import add_spacing_after_data_tables


class TableSpacingParityTests(unittest.TestCase):
    def test_shared_typescript_python_cases(self) -> None:
        fixtures = (
            Path(__file__).resolve().parents[1] / "fixtures/generator/table-spacing-cases.json"
        )
        cases = json.loads(fixtures.read_text(encoding="utf-8"))
        styles = etree.fromstring(
            f'<w:styles xmlns:w="{WORD_NS}"><w:style w:styleId="WideGap"><w:basedOn w:val="Parent"/>'
            '</w:style><w:style w:styleId="Parent"><w:pPr><w:spacing w:before="360"/>'
            '</w:pPr></w:style><w:style w:styleId="TableFollowingText"><w:basedOn w:val="Normal"/>'
            '<w:pPr><w:spacing w:before="120"/></w:pPr></w:style></w:styles>'
        )
        caption = "<w:p><w:r><w:t>Таблица 1</w:t></w:r></w:p>"
        table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
        for case in cases:
            with self.subTest(name=case["name"]):
                document = etree.fromstring(
                    f'<w:document xmlns:w="{WORD_NS}"><w:body>{caption}{table}'
                    f"{case['paragraph']}</w:body></w:document>"
                )
                original = etree.tostring(document)
                changed = add_spacing_after_data_tables(document, styles)
                if case.get("unchanged"):
                    self.assertEqual(changed, 0)
                    self.assertEqual(etree.tostring(document), original)
                self.assertEqual(add_spacing_after_data_tables(document, styles), 0)
                before = document.xpath(
                    "./w:body/w:p[2]/w:pPr/w:spacing/@w:before", namespaces={"w": WORD_NS}
                )
                self.assertEqual(before, [case["before"]] if case["before"] else [])
                if case["name"] == "normal-text":
                    self.assertEqual(
                        document.xpath(
                            "./w:body/w:p[2]/w:pPr/w:pStyle/@w:val", namespaces={"w": WORD_NS}
                        ),
                        ["TableFollowingText"],
                    )
                body = document.find(f"{{{WORD_NS}}}body")
                self.assertEqual(len(body), 3 if case["paragraph"] else 2)


if __name__ == "__main__":
    unittest.main()
