import unittest
from pathlib import Path

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS
from scripts.sto_post_build.math_conversion import (
    convert_mathml_to_omath,
    latex_to_mathml_batch,
    normalize_accents,
)
from scripts.sto_post_build.script_structure import normalize_script_structure

NS = {"m": MATH_NS}


class ScriptStructureTests(unittest.TestCase):
    def test_tex_prime_limits_and_accent_scope(self):
        source = [
            "I'",
            "I^{'}",
            "I^{''}",
            r"x^{a'}",
            r"\sum_i^{} x_i",
            r"\sum_{}^n x_i",
            r"\sum x",
            r"\sum_i^n x_i",
            r"\hat d_i",
            r"\hat{d_i}",
        ]
        root = Path(__file__).resolve().parents[2]
        formulas = convert_mathml_to_omath(latex_to_mathml_batch(source, root), root)
        self.assertEqual(len(formulas), len(source))
        for formula in formulas:
            self.assertEqual(
                formula.xpath(".//m:sup/m:sSup[not(m:e//m:t/text())]", namespaces=NS), []
            )
            before = etree.tostring(formula)
            normalize_script_structure(formula)
            self.assertEqual(etree.tostring(formula), before)
        self.assertEqual(len(formulas[1].xpath(".//m:sSup", namespaces=NS)), 1)
        self.assertEqual("".join(formulas[2].itertext()), "I″")
        self.assertEqual(len(formulas[3].xpath(".//m:sSup", namespaces=NS)), 2)
        self.assertEqual(len(formulas[4].xpath(".//m:limUpp", namespaces=NS)), 0)
        self.assertEqual(len(formulas[4].xpath(".//m:nary", namespaces=NS)), 1)
        self.assertEqual(len(formulas[5].xpath(".//m:limLow", namespaces=NS)), 0)
        self.assertEqual(len(formulas[7].xpath(".//m:nary", namespaces=NS)), 1)
        self.assertEqual(formulas[8].xpath(".//m:acc/m:e//m:t/text()", namespaces=NS), ["d"])
        self.assertEqual(formulas[9].xpath(".//m:acc/m:e//m:t/text()", namespaces=NS), ["d", "i"])
        self.assertEqual(formulas[8].xpath(".//m:accPr/m:chr/@m:val", namespaces=NS), ["\u0302"])

    def test_native_nary_operators_preserve_limits_operands_and_literals(self):
        source = [
            r"\sum_i x_i",
            r"\sum_i^{} x_i",
            r"\sum x",
            r"\prod_i x_i",
            r"\int_0^1 x^2\,\mathrm{d}x",
            r"\prod x",
            r"\text{∑x}",
            r"\sum\nolimits_i x_i",
        ]
        root = Path(__file__).resolve().parents[2]
        formulas = convert_mathml_to_omath(latex_to_mathml_batch(source, root), root)
        self.assertEqual(etree.tostring(formulas[0]), etree.tostring(formulas[1]))
        for index in (0, 1, 2, 3, 4, 5, 7):
            self.assertEqual(len(formulas[index].xpath(".//m:nary", namespaces=NS)), 1)
        self.assertEqual(formulas[3].xpath(".//m:naryPr/m:chr/@m:val", namespaces=NS), ["∏"])
        self.assertEqual(
            formulas[4].xpath(".//m:naryPr/m:limLoc/@m:val", namespaces=NS), ["subSup"]
        )
        self.assertEqual(formulas[4].xpath(".//m:nary/m:e//m:t/text()", namespaces=NS), ["x", "2"])
        self.assertTrue("".join(formulas[4].itertext()).endswith("dx"))
        self.assertEqual(formulas[6].xpath(".//m:nary", namespaces=NS), [])
        self.assertEqual(
            formulas[7].xpath(".//m:naryPr/m:limLoc/@m:val", namespaces=NS), ["subSup"]
        )
        for index in (0, 2, 3, 5):
            self.assertEqual(
                formulas[index].xpath(".//m:naryPr/m:grow/@m:val", namespaces=NS), ["1"]
            )
        for index in (0, 2, 5):
            self.assertEqual(
                formulas[index].xpath(".//m:naryPr/m:supHide/@m:val", namespaces=NS), ["1"]
            )

    def test_bar_position_and_scripted_literals_preserve_source_roles(self):
        source = [
            r"\underline{AB}",
            r"\overline{AB}",
            r"\text{∑x}_i",
            r"\text{∑x}^2",
            r"\text{∏x}_i^2",
            r"\text{∏x}^2",
            r"{\sum}_{i}x_i",
            r"{\prod}^{N}x_i",
            r"\operatorname{∑x}_i",
            r"\operatorname{∏x}^2",
        ]
        root = Path(__file__).resolve().parents[2]
        formulas = convert_mathml_to_omath(latex_to_mathml_batch(source, root), root)
        self.assertEqual(formulas[0].xpath(".//m:barPr/m:pos/@m:val", namespaces=NS), ["bot"])
        self.assertEqual(formulas[1].xpath(".//m:barPr/m:pos/@m:val", namespaces=NS), ["top"])
        for index in (2, 3, 4, 5, 8, 9):
            self.assertEqual(formulas[index].xpath(".//m:nary", namespaces=NS), [])
            text = "".join(formulas[index].itertext())
            self.assertIn("∑x" if index in (2, 3, 8) else "∏x", text)
            self.assertNotIn("LITERAL", text)
        for index in (6, 7):
            self.assertEqual(len(formulas[index].xpath(".//m:nary", namespaces=NS)), 1)

    def test_nested_bars_and_accents_normalize_inner_first(self):
        raw = etree.fromstring(
            f'<m:oMath xmlns:m="{MATH_NS}"><m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="―" m:pos="bot"/></m:groupChrPr><m:e><m:r><m:t>AB</m:t></m:r></m:e></m:groupChr></m:e><m:lim><m:r><m:t>¯</m:t></m:r></m:lim></m:limUpp></m:oMath>'.encode()
        )
        normalize_accents(raw)
        self.assertEqual(raw.xpath(".//m:barPr/m:pos/@m:val", namespaces=NS), ["top", "bot"])
        self.assertEqual(raw.xpath(".//m:groupChr", namespaces=NS), [])
        root = Path(__file__).resolve().parents[2]
        source = [r"\overline{\underline{AB}}", r"\bar{\tilde{x}}"]
        formulas = convert_mathml_to_omath(latex_to_mathml_batch(source, root), root)
        self.assertEqual(
            formulas[0].xpath(".//m:barPr/m:pos/@m:val", namespaces=NS), ["top", "bot"]
        )
        self.assertEqual(formulas[0].xpath(".//m:groupChr", namespaces=NS), [])
        self.assertEqual(formulas[1].xpath(".//m:barPr/m:pos/@m:val", namespaces=NS), ["top"])
        self.assertEqual(formulas[1].xpath(".//m:accPr/m:chr/@m:val", namespaces=NS), ["\u0303"])
        self.assertEqual(formulas[1].xpath(".//m:limUpp", namespaces=NS), [])

    def test_mathml_operator_tokens_stay_upright(self):
        root = Path(__file__).resolve().parents[2]
        source = [
            r"d_{\min}+d_{\max}",
            r"\max(x,y)",
            r"\min_i x_i",
            r"\text{median}_{i} x_i",
            r"m+a+x",
        ]
        formulas = convert_mathml_to_omath(latex_to_mathml_batch(source, root), root)
        for formula in formulas[:-1]:
            operators = formula.xpath(
                './/m:r[m:t="min" or m:t="max" or m:t="median"]', namespaces=NS
            )
            self.assertTrue(operators)
            for operator in operators:
                self.assertEqual(len(operator.xpath("./m:rPr/m:nor", namespaces=NS)), 1)
        self.assertEqual(formulas[-1].xpath(".//m:rPr/m:nor", namespaces=NS), [])

    def test_omml_hides_only_absent_limits_and_preserves_scripts(self):
        xml = f'''<m:oMath xmlns:m="{MATH_NS}"><m:nary><m:naryPr><m:chr m:val="∑"/>
          <m:supHide m:val="0"/><m:ctrlPr/></m:naryPr><m:sub/><m:sup/><m:e/></m:nary>
          <m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>i</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e/></m:nary></m:oMath>'''
        math = etree.fromstring(xml.encode())
        normalize_script_structure(math)
        self.assertEqual(math.xpath(".//m:naryPr/m:subHide/@m:val", namespaces=NS), ["1"])
        self.assertEqual(math.xpath(".//m:naryPr/m:supHide/@m:val", namespaces=NS), ["1"])
        self.assertEqual(
            [etree.QName(child).localname for child in math[0][0]],
            ["chr", "subHide", "supHide", "ctrlPr"],
        )
        for base, sup in (("", "2"), ("a", "\u2032")):
            script = etree.fromstring(
                f'<m:oMath xmlns:m="{MATH_NS}"><m:sSup><m:e/><m:sup><m:sSup><m:e><m:r><m:t>{base}</m:t></m:r></m:e><m:sup><m:r><m:t>{sup}</m:t></m:r></m:sup></m:sSup></m:sup></m:sSup></m:oMath>'.encode()
            )
            before = etree.tostring(script)
            normalize_script_structure(script)
            self.assertEqual(etree.tostring(script), before)


if __name__ == "__main__":
    unittest.main()
