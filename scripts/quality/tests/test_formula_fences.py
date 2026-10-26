"""Post-build conversion must retain the scalable fences used by Word math."""

import unittest
from pathlib import Path
from typing import Any, ClassVar

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS, WORD_NS
from scripts.sto_post_build.math_conversion import (
    MATHML_NS,
    convert_mathml_to_omath,
    latex_to_mathml_batch,
    mark_mathml_fences,
    restore_omml_fences,
)


class FormulaFenceTests(unittest.TestCase):
    namespaces: ClassVar[dict[str, str]] = {"m": MATH_NS, "w": WORD_NS}
    formulas: ClassVar[list[str]] = [
        r"\left(\frac{a}{b}\right)",
        r"\begin{bmatrix}1&2\\3&4\end{bmatrix}",
        r"\begin{pmatrix}1&2\\3&4\end{pmatrix}",
        r"\begin{Bmatrix}1&2\\3&4\end{Bmatrix}",
        r"\begin{vmatrix}1&2\\3&4\end{vmatrix}",
        r"\begin{Vmatrix}1&2\\3&4\end{Vmatrix}",
        r"A=\left[\left(\frac{a}{b}\right)+\begin{bmatrix}1&2\\3&4\end{bmatrix}\right]x+B",
        r"\left.\frac{a}{b}\right]",
        r"\left\{\frac{a}{b}\right.",
        r"(\frac{a}{b})",
        r"\left(a\right)\left(b\right)",
    ]
    converted: ClassVar[list[Any]]

    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cls.converted = convert_mathml_to_omath(
            latex_to_mathml_batch(cls.formulas, repo_root), repo_root
        )

    def visible_text(self, element: Any) -> str:
        return "".join(
            element.xpath(
                ".//m:t[not(ancestor::m:phant[m:phantPr/m:show[@m:val='0']])]/text()",
                namespaces=self.namespaces,
            )
        )

    def assert_fence(self, element: Any, begin: str, end: str) -> Any:
        self.assertEqual(element.tag, f"{{{MATH_NS}}}d")
        for name, expected in (("begChr", begin), ("endChr", end), ("grow", "1")):
            self.assertEqual(
                element.xpath(f"./m:dPr/m:{name}/@m:val", namespaces=self.namespaces),
                [expected],
            )
        expressions = element.xpath("./m:e", namespaces=self.namespaces)
        self.assertEqual(len(expressions), 1)
        return expressions[0]

    def test_fraction_keeps_dynamic_parentheses(self) -> None:
        expression = self.assert_fence(self.converted[0][0], "(", ")")
        self.assertEqual(len(expression.xpath("./m:f", namespaces=self.namespaces)), 1)
        self.assertEqual(self.visible_text(self.converted[0]), "ab")

    def test_matrix_fence_variants_keep_all_cells(self) -> None:
        for formula, characters in zip(
            self.converted[1:6],
            [("[", "]"), ("(", ")"), ("{", "}"), ("|", "|"), ("‖", "‖")],
            strict=True,
        ):
            with self.subTest(characters=characters):
                expression = self.assert_fence(formula[0], *characters)
                rows = expression.xpath("./m:m/m:mr", namespaces=self.namespaces)
                self.assertEqual(
                    [["".join(cell.itertext()) for cell in row] for row in rows],
                    [["1", "2"], ["3", "4"]],
                )
                self.assertEqual(len(formula.xpath(".//m:d", namespaces=self.namespaces)), 1)

    def test_nested_fences_preserve_adjacent_expressions(self) -> None:
        formula = self.converted[6]
        self.assertEqual([etree.QName(child).localname for child in formula], ["r", "d", "r"])
        expression = self.assert_fence(formula[1], "[", "]")
        inner = expression.xpath("./m:d", namespaces=self.namespaces)
        self.assertEqual(len(inner), 2)
        self.assert_fence(inner[0], "(", ")")
        self.assert_fence(inner[1], "[", "]")
        self.assertEqual(self.visible_text(formula), "A=ab+1234x+B")

    def test_one_sided_fences_remain_invisible(self) -> None:
        for formula, characters in zip(self.converted[7:9], [("", "]"), ("{", "")], strict=True):
            with self.subTest(characters=characters):
                self.assert_fence(formula[0], *characters)

    def test_literal_parentheses_are_not_made_scalable(self) -> None:
        formula = self.converted[9]
        self.assertEqual(formula.xpath(".//m:d", namespaces=self.namespaces), [])
        self.assertEqual("".join(formula.itertext()), "(ab)")

    def test_adjacent_fences_keep_independent_expressions(self) -> None:
        formula = self.converted[10]
        self.assertEqual(len(formula), 2)
        for fence, expected in zip(formula, ["a", "b"], strict=True):
            expression = self.assert_fence(fence, "(", ")")
            self.assertEqual("".join(expression.itertext()), expected)

    def test_unpaired_mathml_fence_is_left_unchanged(self) -> None:
        mathml = (
            f'<math xmlns="{MATHML_NS}"><mrow data-mjx-texclass="INNER">'
            '<mo data-mjx-texclass="OPEN">(</mo><mi>x</mi></mrow></math>'
        )
        self.assertEqual(mark_mathml_fences(mathml), (mathml, []))

    def test_lost_marker_aborts_instead_of_leaking_or_dropping_math(self) -> None:
        mathml = (
            f'<math xmlns="{MATHML_NS}"><mrow data-mjx-texclass="INNER">'
            '<mo data-mjx-texclass="OPEN">(</mo><mi>x</mi>'
            '<mo data-mjx-texclass="CLOSE">)</mo></mrow></math>'
        )
        _, descriptors = mark_mathml_fences(mathml)
        self.assertEqual(len(descriptors), 1)
        omml = f'<m:oMath xmlns:m="{MATH_NS}"><m:r><m:t>x</m:t></m:r></m:oMath>'
        with self.assertRaisesRegex(RuntimeError, "shared expression container"):
            restore_omml_fences(omml, descriptors)

    def test_merged_markers_preserve_text_styles_and_avoid_collisions(self) -> None:
        collision = "\ue100FENCE0OPEN\ue101\ue100FENCEX"
        mathml = (
            f'<math xmlns="{MATHML_NS}"><mtext>{collision}</mtext>'
            '<mrow data-mjx-texclass="INNER"><mo data-mjx-texclass="OPEN">[</mo>'
            '<mi>x</mi><mo data-mjx-texclass="CLOSE">]</mo></mrow></math>'
        )
        _, descriptors = mark_mathml_fences(mathml)
        descriptor = descriptors[0]
        self.assertNotIn(descriptor["open"], collision)
        properties = '<w:rPr><w:color w:val="C00000"/></w:rPr>'
        omml = (
            f'<m:oMath xmlns:m="{MATH_NS}" xmlns:w="{WORD_NS}">'
            f"<m:r>{properties}<m:t>{collision}A={descriptor['open']}x"
            f"{descriptor['close']}y+B</m:t></m:r></m:oMath>"
        )
        formula = etree.fromstring(restore_omml_fences(omml, descriptors).encode())
        expression = self.assert_fence(formula[1], "[", "]")
        self.assertEqual("".join(expression.itertext()), "x")
        self.assertEqual("".join(formula.itertext()), f"{collision}A=xy+B")
        self.assertEqual(
            formula.xpath("./m:r/w:rPr/w:color/@w:val", namespaces=self.namespaces),
            ["C00000", "C00000"],
        )
        self.assertEqual(
            formula.xpath("./m:d/m:dPr/m:ctrlPr/w:rPr/w:color/@w:val", namespaces=self.namespaces),
            ["C00000"],
        )
        self.assertNotIn(descriptor["open"], etree.tostring(formula, encoding="unicode"))


if __name__ == "__main__":
    unittest.main()
