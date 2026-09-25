import unittest
from pathlib import Path

from scripts.sto_post_build.constants import MATH_NS, WORD_NS
from scripts.sto_post_build.math_conversion import (
    convert_mathml_to_omath,
    latex_to_mathml_batch,
)


class MathSemanticPostBuildTests(unittest.TestCase):
    def test_explicit_roles_survive_formula_replacement_conversion(self) -> None:
        formulas = [
            r"\stovec{a}",
            r"\stomat{A}",
            r"\stotemp{K}",
            r"\stoelem{Fe}",
            r"x_{\stoabbr{max}}",
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


if __name__ == "__main__":
    unittest.main()
