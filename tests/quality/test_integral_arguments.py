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


if __name__ == "__main__":
    unittest.main()
