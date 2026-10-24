"""Post-build systems preserve every row and their source column alignment."""

import unittest
from pathlib import Path
from typing import Any, ClassVar

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS
from scripts.sto_post_build.math_conversion import (
    MATHML_NS,
    collect_matrix_alignments,
    convert_mathml_to_omath,
    latex_to_mathml_batch,
    restore_matrix_alignments,
)


class FormulaSystemTests(unittest.TestCase):
    namespaces: ClassVar[dict[str, str]] = {"m": MATH_NS}
    formulas: ClassVar[list[str]] = [
        r"f(x)=\begin{cases}\frac{a}{b}&\text{when a is negative}\\c&\text{when a belongs to a much longer interval}\\d&\text{otherwise}\end{cases}",
        r"\left\{\begin{aligned}x&=a\\y&=\frac{b}{c}\\z&=d\end{aligned}\right.",
        r"\begin{array}{rl}a&b\\c&d\\e&f\end{array}",
        r"\begin{array}{lcr}a&b&c\\d&e&f\\g&h&i\end{array}",
        r"\begin{bmatrix}a&b\\c&d\end{bmatrix}",
        r"\begin{cases}\begin{matrix}1&2\\3&4\end{matrix}&a\\b&c\end{cases}",
        r"\begin{array}{rl}\begin{array}{lcr}a&b&c\end{array}&d\\e&f\end{array}",
    ]
    converted: ClassVar[list[Any]]

    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cls.converted = convert_mathml_to_omath(
            latex_to_mathml_batch(cls.formulas, repo_root), repo_root
        )

    def matrices(self, formula: int) -> list[Any]:
        return self.converted[formula].xpath(".//m:m", namespaces=self.namespaces)

    def assert_matrix(self, matrix: Any, alignment: list[str], cells: list[list[str]]) -> None:
        properties = matrix.findall(f"{{{MATH_NS}}}mPr")
        self.assertEqual(len(properties), 1)
        columns = properties[0].findall(f"{{{MATH_NS}}}mcs")
        self.assertEqual(len(columns), 1)
        actual = []
        for group in columns[0]:
            count = group.xpath("./m:mcPr/m:count/@m:val", namespaces=self.namespaces)
            justification = group.xpath("./m:mcPr/m:mcJc/@m:val", namespaces=self.namespaces)
            self.assertEqual(len(count), 1)
            self.assertEqual(len(justification), 1)
            self.assertGreater(int(count[0]), 0)
            actual.extend([justification[0]] * int(count[0]))
        self.assertEqual(actual, alignment)
        self.assertEqual(
            [
                ["".join(cell.itertext()).replace("\u00a0", " ") for cell in row]
                for row in matrix.findall(f"{{{MATH_NS}}}mr")
            ],
            cells,
        )

    def test_every_control_and_matrix_is_discovered(self) -> None:
        self.assertEqual(len(self.formulas), 7)
        self.assertEqual(len(self.converted), 7)
        self.assertEqual([len(self.matrices(index)) for index in range(7)], [1, 1, 1, 1, 1, 2, 2])
        for formula in self.converted:
            self.assertNotRegex(etree.tostring(formula, encoding="unicode"), "口|\ue100|\ue101")

    def test_cases_keep_three_rows_long_conditions_and_tall_fraction(self) -> None:
        self.assert_matrix(
            self.matrices(0)[0],
            ["left", "left"],
            [
                ["ab", "when a is negative"],
                ["c", "when a belongs to a much longer interval"],
                ["d", "otherwise"],
            ],
        )
        self.assertEqual(len(self.converted[0].xpath(".//m:f", namespaces=self.namespaces)), 1)

    def test_aligned_system_keeps_right_left_columns(self) -> None:
        self.assert_matrix(
            self.matrices(1)[0], ["right", "left"], [["x", "=a"], ["y", "=bc"], ["z", "=d"]]
        )
        self.assertEqual(len(self.converted[1].xpath(".//m:f", namespaces=self.namespaces)), 1)

    def test_case_and_aligned_braces_remain_one_sided_scalable(self) -> None:
        for index in (0, 1, 5):
            with self.subTest(index=index):
                self.assertEqual(
                    self.converted[index].xpath(
                        "./m:d/m:dPr/m:begChr/@m:val", namespaces=self.namespaces
                    ),
                    ["{"],
                )
                self.assertEqual(
                    self.converted[index].xpath(
                        "./m:d/m:dPr/m:endChr/@m:val", namespaces=self.namespaces
                    ),
                    [""],
                )
                self.assertEqual(
                    self.converted[index].xpath(
                        "./m:d/m:dPr/m:grow/@m:val", namespaces=self.namespaces
                    ),
                    ["1"],
                )

    def test_arrays_keep_two_and_three_distinct_column_alignments(self) -> None:
        self.assert_matrix(
            self.matrices(2)[0], ["right", "left"], [["a", "b"], ["c", "d"], ["e", "f"]]
        )
        self.assert_matrix(
            self.matrices(3)[0],
            ["left", "center", "right"],
            [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]],
        )

    def test_default_matrix_remains_centered(self) -> None:
        self.assert_matrix(self.matrices(4)[0], ["center", "center"], [["a", "b"], ["c", "d"]])

    def test_nested_matrices_keep_preorder_and_independent_columns(self) -> None:
        self.assert_matrix(self.matrices(5)[0], ["left", "left"], [["1234", "a"], ["b", "c"]])
        self.assert_matrix(self.matrices(5)[1], ["center", "center"], [["1", "2"], ["3", "4"]])
        self.assert_matrix(self.matrices(6)[0], ["right", "left"], [["abc", "d"], ["e", "f"]])
        self.assert_matrix(self.matrices(6)[1], ["left", "center", "right"], [["a", "b", "c"]])

    def test_alignment_repeats_to_all_columns(self) -> None:
        mathml = (
            f'<math xmlns="{MATHML_NS}"><mtable columnalign="left"><mtr>'
            "<mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd><mtd><mi>c</mi></mtd>"
            "</mtr></mtable></math>"
        )
        self.assertEqual(
            collect_matrix_alignments(mathml),
            [{"columns": ["left", "left", "left"], "row_lengths": [3], "parent": None}],
        )
        with self.assertRaisesRegex(RuntimeError, "Unsupported MathML matrix column alignment"):
            collect_matrix_alignments(
                mathml.replace('columnalign="left"', 'columnalign="decimalpoint"')
            )

    def test_matrix_count_dimensions_and_parent_mismatch_abort(self) -> None:
        source = [{"columns": ["left", "left"], "row_lengths": [2], "parent": None}]
        with self.assertRaisesRegex(RuntimeError, "matrix count mismatch"):
            restore_matrix_alignments(f'<m:oMath xmlns:m="{MATH_NS}"/>', source)
        short = f'<m:oMath xmlns:m="{MATH_NS}"><m:m><m:mr><m:e/></m:mr></m:m></m:oMath>'
        with self.assertRaisesRegex(RuntimeError, "nesting or dimensions mismatch"):
            restore_matrix_alignments(short, source)
        nested = (
            f'<m:oMath xmlns:m="{MATH_NS}"><m:m><m:mr><m:e><m:m><m:mr><m:e/>'
            "</m:mr></m:m></m:e></m:mr></m:m></m:oMath>"
        )
        with self.assertRaisesRegex(RuntimeError, "nesting or dimensions mismatch"):
            restore_matrix_alignments(
                nested,
                [
                    {"columns": ["left"], "row_lengths": [1], "parent": None},
                    {"columns": ["right"], "row_lengths": [1], "parent": None},
                ],
            )


if __name__ == "__main__":
    unittest.main()
