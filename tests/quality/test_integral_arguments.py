import json
import unittest
from pathlib import Path

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS
from scripts.sto_post_build.integral_arguments import normalize_empty_integral_arguments
from scripts.sto_post_build.math_conversion import (
    convert_mathml_to_omath,
    latex_to_mathml_batch,
)


class IntegralArgumentTests(unittest.TestCase):
    def test_shared_normalization_cases_and_idempotence(self) -> None:
        fixture = Path(__file__).resolve().parents[1] / "fixtures/formulas/integral-arguments.json"
        cases = json.loads(fixture.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(cases), 30)
        for case in cases:
            with self.subTest(case=case["name"]):
                root = etree.fromstring(
                    f'<m:oMath xmlns:m="{MATH_NS}">{case["source"]}</m:oMath>'.encode()
                )
                expected = etree.fromstring(
                    f'<m:oMath xmlns:m="{MATH_NS}">{case["expected"]}</m:oMath>'.encode()
                )
                normalize_empty_integral_arguments(root)
                self.assertEqual(etree.tostring(root), etree.tostring(expected))
                first_pass = etree.tostring(root)
                self.assertEqual(normalize_empty_integral_arguments(root), 0)
                self.assertEqual(etree.tostring(root), first_pass)

    def test_conversion_repairs_integral_without_consuming_differential(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        values = latex_to_mathml_batch(
            [r"\operatorname{Integral}=\int_0^1 x^2\,\mathrm{d}x."], repo_root
        )
        root = convert_mathml_to_omath(values, repo_root)[0]
        integral = root.find(f"{{{MATH_NS}}}nary")
        self.assertIsNotNone(integral)
        self.assertEqual(
            [child.tag for child in integral.find(f"{{{MATH_NS}}}e")],
            [f"{{{MATH_NS}}}sSup"],
        )
        self.assertEqual(
            "".join("".join(node.itertext()) for node in integral.itersiblings()).strip(),
            "dx.",
        )

    def test_repairs_sum_and_product_without_consuming_following_expression(self) -> None:
        cases = [
            ("∑", "sSup", "sup", "(m)"),
            ("∏", "sSub", "sub", "m"),
        ]
        for character, operand_tag, script_tag, script_text in cases:
            with self.subTest(operator=character):
                root = etree.fromstring(
                    f'<m:oMath xmlns:m="{MATH_NS}">'
                    f'<m:nary><m:naryPr><m:chr m:val="{character}"/></m:naryPr>'
                    "<m:sub><m:r><m:t>m=1</m:t></m:r></m:sub>"
                    "<m:sup><m:r><m:t>M</m:t></m:r></m:sup><m:e/></m:nary>"
                    f"<m:{operand_tag}><m:e><m:r><m:t>t</m:t></m:r></m:e>"
                    f"<m:{script_tag}><m:r><m:t>{script_text}</m:t></m:r></m:{script_tag}>"
                    f"</m:{operand_tag}><m:r><m:t>+y.</m:t></m:r></m:oMath>"
                )
                self.assertEqual(normalize_empty_integral_arguments(root), 1)
                operator = root.find(f"{{{MATH_NS}}}nary")
                self.assertIsNotNone(operator)
                argument = operator.find(f"{{{MATH_NS}}}e")
                self.assertEqual([child.tag for child in argument], [f"{{{MATH_NS}}}{operand_tag}"])
                self.assertEqual("".join(argument.itertext()), f"t{script_text}")
                self.assertEqual(
                    "".join("".join(node.itertext()) for node in operator.itersiblings()).strip(),
                    "+y.",
                )


if __name__ == "__main__":
    unittest.main()
