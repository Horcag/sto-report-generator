import unittest
from pathlib import Path

from scripts.sto_post_build.constants import MATH_NS, WORD_NS
from scripts.sto_post_build.math_conversion import (
    convert_mathml_to_omath,
    latex_to_mathml_batch,
)


class MathSemanticPostBuildTests(unittest.TestCase):
    def test_accents_are_math_accents_and_bars_not_upper_limits(self) -> None:
        formulas = [
            r"\bar{R}_x",
            r"\overline{AB}",
            r"\tilde{y}",
            r"\hat{x}",
            r"\vec{v}",
            r"\sum_{i=1}^{n}x_i",
        ]
        repo_root = Path(__file__).resolve().parents[2]
        mathml = latex_to_mathml_batch(formulas, repo_root)
        omath = convert_mathml_to_omath(mathml, repo_root)
        namespaces = {"m": MATH_NS}

        for element in omath[:2]:
            self.assertEqual(len(element.xpath(".//m:bar", namespaces=namespaces)), 1)
            self.assertEqual(
                element.xpath(".//m:bar/m:barPr/m:pos/@m:val", namespaces=namespaces),
                ["top"],
            )
            self.assertEqual(
                element.xpath(".//m:bar/m:e/m:sSup | .//m:bar/m:e/m:sSub", namespaces=namespaces),
                [],
            )
        for element, character in zip(omath[2:5], ("\u0303", "\u0302", "\u20d7"), strict=True):
            self.assertEqual(
                element.xpath(".//m:acc/m:accPr/m:chr/@m:val", namespaces=namespaces),
                [character],
            )
        for element in omath[:5]:
            self.assertEqual(len(element.xpath(".//m:limUpp", namespaces=namespaces)), 0)
        self.assertEqual(len(omath[5].xpath(".//m:limUpp", namespaces=namespaces)), 1)
        self.assertEqual(
            omath[5].xpath(".//m:limUpp/m:e/m:limLow/m:lim//m:t/text()", namespaces=namespaces),
            ["i=1"],
        )
        self.assertEqual(
            omath[5].xpath(".//m:limUpp/m:lim//m:t/text()", namespaces=namespaces),
            ["n"],
        )

    def test_composite_formula_overbar_has_no_empty_script(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        formula = r"\bar{y}=\frac{1}{n}\sum_{i=1}^{n}y_i,\quad\tilde{y}=\operatorname{median}(y_1,\ldots,y_n)"
        mathml = latex_to_mathml_batch([formula], repo_root)
        omath = convert_mathml_to_omath(mathml, repo_root)[0]
        namespaces = {"m": MATH_NS}
        self.assertEqual(
            omath.xpath(".//m:bar/m:e/m:sSup | .//m:bar/m:e/m:sSub", namespaces=namespaces),
            [],
        )
        self.assertEqual(omath.xpath(".//m:bar/m:e/m:r/m:t/text()", namespaces=namespaces), ["y"])

    def test_explicit_roles_survive_formula_replacement_conversion(self) -> None:
        formulas = [
            r"\stovec{a}",
            r"\stomat{A}",
            r"\stotemp{K}",
            r"\stoelem{Fe}",
            r"x_{\stoabbr{max}}",
            r"\min_{k\geq i}x_k",
        ]
        repo_root = Path(__file__).resolve().parents[2]
        mathml = latex_to_mathml_batch(formulas, repo_root)
        omath = convert_mathml_to_omath(mathml, repo_root)
        namespaces = {"m": MATH_NS, "w": WORD_NS}

        for element, symbol in zip(omath[:2], ("a", "A"), strict=True):
            run = element.xpath(f'.//m:r[m:t="{symbol}"]', namespaces=namespaces)[0]
            self.assertEqual(run.xpath("./m:rPr/m:sty/@m:val", namespaces=namespaces), ["b"])
            self.assertEqual(len(run.xpath("./m:rPr/m:nor", namespaces=namespaces)), 1)

        for element, symbol in zip(omath[2:4], ("K", "Fe"), strict=True):
            run = element.xpath(f'.//m:r[m:t="{symbol}"]', namespaces=namespaces)[0]
            self.assertEqual(len(run.xpath("./m:rPr/m:nor", namespaces=namespaces)), 1)

        subscript = omath[4].xpath(".//m:sSub/m:sub", namespaces=namespaces)[0]
        self.assertEqual(subscript.xpath(".//m:r/m:t/text()", namespaces=namespaces), ["max"])
        self.assertEqual(len(subscript.xpath(".//m:r/m:rPr/m:nor", namespaces=namespaces)), 1)

        minimum_run = omath[5].xpath('.//m:limLow/m:e/m:r[m:t="min"]', namespaces=namespaces)[0]
        self.assertEqual(len(minimum_run.xpath("./m:rPr/m:nor", namespaces=namespaces)), 1)

    def test_named_operator_stays_upright_next_to_italic_variable(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        mathml = latex_to_mathml_batch([r"\operatorname{median}(x)"], repo_root)
        formula = convert_mathml_to_omath(mathml, repo_root)[0]
        namespaces = {"m": MATH_NS}
        operator = formula.xpath('.//m:r[m:t="median"]', namespaces=namespaces)
        self.assertEqual(len(operator), 1)
        self.assertEqual(len(operator[0].xpath("./m:rPr/m:nor", namespaces=namespaces)), 1)
        variable = formula.xpath('.//m:r[contains(m:t, "x")]', namespaces=namespaces)
        self.assertEqual(len(variable), 1)
        self.assertEqual(len(variable[0].xpath("./m:rPr/m:nor", namespaces=namespaces)), 0)


if __name__ == "__main__":
    unittest.main()
