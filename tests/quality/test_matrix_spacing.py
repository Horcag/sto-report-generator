import unittest
from pathlib import Path

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS
from scripts.sto_post_build.math_conversion import (
    collect_matrix_alignments,
    latex_to_mathml_batch,
    mathml_to_omml_batch,
    restore_matrix_alignments,
)
from scripts.sto_post_build.matrix_spacing import FONT_SIZE_POINTS

MATHML_NS = "http://www.w3.org/1998/Math/MathML"


def table(spacing: str = "", content: str = "<mi>a</mi>") -> str:
    return f"<mtable {spacing}><mtr><mtd>{content}</mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable>"


def collect(body: str) -> list:
    return collect_matrix_alignments(f'<math xmlns="{MATHML_NS}">{body}</math>')


class MatrixSpacingTests(unittest.TestCase):
    def test_mathjax_conversion(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        formulas = [
            r"\begin{bmatrix}a&b\\c&d\end{bmatrix}",
            r"x^{\begin{pmatrix}a\\b\end{pmatrix}}",
            r"\frac{\begin{pmatrix}a\\b\end{pmatrix}}{2}",
        ]
        values = mathml_to_omml_batch(latex_to_mathml_batch(formulas, repo_root), repo_root)
        for index, xml in enumerate(values):
            root = etree.fromstring(xml.encode())
            spacing = list(root.iter(f"{{{MATH_NS}}}rSp"))
            self.assertEqual(len(spacing), 1 if index == 0 else 0)
            columns = list(root.iter(f"{{{MATH_NS}}}cGp"))
            self.assertEqual(len(columns), 1 if index == 0 else 0)
            if columns:
                self.assertEqual(columns[0].get(f"{{{MATH_NS}}}val"), "280")
            if spacing:
                self.assertEqual(spacing[0].get(f"{{{MATH_NS}}}val"), "416")

    def test_column_gaps(self) -> None:
        for source, expected in (
            ("1em", 280),
            ("4pt", 80),
            (".5em 0.50em", 140),
            ("1em 14pt", 280),
            ("0pt", 0),
        ):
            with self.subTest(source=source):
                self.assertEqual(
                    collect(table(f'columnspacing="{source}"'))[0]["columnGapTwips"], expected
                )
        for source in ("", "1px", "1em 2em", "-1em", "NaNem", "1e2pt", "4pt invalid"):
            self.assertNotIn("columnGapTwips", collect(table(f'columnspacing="{source}"'))[0])
        self.assertNotIn("columnGapTwips", collect(table())[0])

    def test_uniform_point_gaps(self) -> None:
        self.assertEqual(FONT_SIZE_POINTS, 14)
        for source, expected in (
            ("4pt", 416),
            ("4pt 4.0pt", 416),
            (".5pt 0.50pt", 346),
            ("0pt", 336),
            ("4.125pt", 419),
        ):
            with self.subTest(source=source):
                self.assertEqual(
                    collect(table(f'rowspacing="{source}"'))[0]["minRowBaselineTwips"], expected
                )

    def test_unsupported_and_missing_gaps(self) -> None:
        self.assertNotIn("minRowBaselineTwips", collect(table())[0])
        for source in (
            "",
            "4em",
            "4px",
            "4pt 5pt",
            "-1pt",
            "NaNpt",
            "Infinitypt",
            "4pt invalid",
            "4",
            "1e2pt",
        ):
            with self.subTest(source=source):
                self.assertNotIn("minRowBaselineTwips", collect(table(f'rowspacing="{source}"'))[0])

    def test_size_contexts_and_normal_nested_matrix(self) -> None:
        matrix = table('rowspacing="4pt" columnspacing="1em"')
        for wrapper in (
            "mfrac",
            "msqrt",
            "mroot",
            "msub",
            "msup",
            "msubsup",
            "munder",
            "mover",
            "munderover",
            "mmultiscripts",
        ):
            with self.subTest(wrapper=wrapper):
                self.assertNotIn(
                    "columnGapTwips", collect(f"<{wrapper}>{matrix}<mi>x</mi></{wrapper}>")[0]
                )
                self.assertNotIn(
                    "minRowBaselineTwips",
                    collect(f"<{wrapper}>{matrix}<mi>x</mi></{wrapper}>")[0],
                )
        for attribute in ('scriptlevel="1"', 'scriptlevel="+1"', 'mathsize="small"'):
            self.assertNotIn("columnGapTwips", collect(f"<mstyle {attribute}>{matrix}</mstyle>")[0])
            self.assertNotIn(
                "minRowBaselineTwips",
                collect(f"<mstyle {attribute}>{matrix}</mstyle>")[0],
            )
        nested = collect(table('rowspacing="4pt"', table('rowspacing="4pt" columnspacing="1em"')))
        self.assertEqual(
            [(item["parent"], item["minRowBaselineTwips"]) for item in nested],
            [(None, 416), (0, 416)],
        )

    def test_order_idempotence_and_visible_topology(self) -> None:
        xml = f'<m:oMath xmlns:m="{MATH_NS}"><m:m><m:mPr><m:baseJc m:val="center"/><m:plcHide m:val="0"/><m:rSp m:val="1"/><m:rSpRule m:val="0"/><m:rSp m:val="2"/><m:cGpRule m:val="0"/><m:cSp m:val="0"/><m:cGp m:val="1"/><m:cGp m:val="2"/><m:mcs/><m:ctrlPr/></m:mPr><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr></m:m></m:oMath>'
        descriptors = collect(table('rowspacing="4pt" columnspacing="1em"'))
        restored = restore_matrix_alignments(xml, descriptors)
        self.assertEqual(restore_matrix_alignments(restored, descriptors), restored)
        root = etree.fromstring(restored.encode())
        properties = root.find(f".//{{{MATH_NS}}}mPr")
        self.assertEqual(
            [etree.QName(child).localname for child in properties],
            ["baseJc", "plcHide", "rSpRule", "cGpRule", "rSp", "cSp", "cGp", "mcs", "ctrlPr"],
        )
        self.assertEqual(properties.find(f"{{{MATH_NS}}}rSpRule").get(f"{{{MATH_NS}}}val"), "3")
        self.assertEqual(properties.find(f"{{{MATH_NS}}}rSp").get(f"{{{MATH_NS}}}val"), "416")
        self.assertEqual(properties.find(f"{{{MATH_NS}}}cGpRule").get(f"{{{MATH_NS}}}val"), "3")
        self.assertEqual(properties.find(f"{{{MATH_NS}}}cGp").get(f"{{{MATH_NS}}}val"), "280")
        source = etree.fromstring(xml.encode())
        self.assertEqual(
            [etree.tostring(row) for row in root.iter(f"{{{MATH_NS}}}mr")],
            [etree.tostring(row) for row in source.iter(f"{{{MATH_NS}}}mr")],
        )
        self.assertNotRegex(restored, r"phant|drawing|pict")
        self.assertIn('<m:rSp m:val="1"', restore_matrix_alignments(xml, collect(table())))
        self.assertIn('<m:cGp m:val="1"', restore_matrix_alignments(xml, collect(table())))
        with self.assertRaisesRegex(RuntimeError, "matrix count mismatch"):
            restore_matrix_alignments(f'<m:oMath xmlns:m="{MATH_NS}"/>', descriptors)
        with self.assertRaisesRegex(RuntimeError, "dimensions mismatch"):
            restore_matrix_alignments(
                xml.replace("<m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr>", ""), descriptors
            )


if __name__ == "__main__":
    unittest.main()
