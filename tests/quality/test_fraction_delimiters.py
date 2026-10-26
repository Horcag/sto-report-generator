import unittest

from lxml import etree
from scripts.sto_post_build.constants import MATH_NS
from scripts.sto_post_build.fraction_delimiters import normalize_fraction_delimiters

M = f"{{{MATH_NS}}}"
FRACTION = "<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>"


def fence(content: str, grow: str = "1", begin: str = "(", end: str = ")") -> str:
    return f'<m:d><m:dPr><m:begChr m:val="{begin}"/><m:endChr m:val="{end}"/><m:grow m:val="{grow}"/></m:dPr><m:e>{content}</m:e></m:d>'


def parse(content: str):
    return etree.fromstring(f'<m:oMath xmlns:m="{MATH_NS}">{content}</m:oMath>'.encode())


class FractionDelimiterTests(unittest.TestCase):
    def assert_clearance(self, root, expected: int = 1) -> None:
        before = etree.tostring(root)
        self.assertEqual(normalize_fraction_delimiters(root), expected)
        first = etree.tostring(root)
        self.assertEqual(normalize_fraction_delimiters(root), 0)
        self.assertEqual(etree.tostring(root), first)
        phantoms = list(root.iter(f"{M}phant"))
        self.assertEqual(len(phantoms), expected)
        for phantom in phantoms:
            self.assertEqual(phantom.find(f"{M}phantPr/{M}show").get(f"{M}val"), "0")
            self.assertEqual(phantom.find(f"{M}phantPr/{M}zeroWid").get(f"{M}val"), "1")
            base = phantom.find(f"{M}e/{M}box/{M}e")
            self.assertIsNotNone(base)
            self.assertEqual(base[0].tag, f"{M}argPr")
            self.assertEqual(base[0][0].tag, f"{M}argSz")
            self.assertEqual(base[0][0].get(f"{M}val"), "1")
            original = phantom.getparent()
            self.assertEqual(
                [etree.tostring(child) for child in base[1:]],
                [etree.tostring(child) for child in list(original)[:-1]],
            )
            original.remove(phantom)
        self.assertEqual(etree.tostring(root), before)

    def test_paired_one_sided_and_powered_fraction_fences(self) -> None:
        for grow in ("1", "true", "on"):
            for begin, end in (("(", ")"), ("[", "]"), ("", ")"), ("(", "")):
                with self.subTest(grow=grow, begin=begin, end=end):
                    self.assert_clearance(parse(fence(FRACTION, grow, begin, end)))
        self.assert_clearance(
            parse(
                f"<m:sSup><m:e>{fence(FRACTION)}</m:e><m:sup><m:r><m:t>3/2</m:t></m:r></m:sup></m:sSup>"
            )
        )

    def test_guards_preserve_original_xml(self) -> None:
        matrix = f"<m:m><m:mr><m:e>{FRACTION}</m:e></m:mr></m:m>"
        for content in (
            FRACTION,
            fence("<m:r><m:t>x</m:t></m:r>"),
            *(fence(FRACTION, grow) for grow in ("0", "false", "off", "")),
            fence(FRACTION, "1", "", ""),
            fence(matrix),
            fence('<m:argPr><m:argSz m:val="-1"/></m:argPr>' + FRACTION),
            fence(matrix * 30 + FRACTION),
            fence(FRACTION).replace("</m:d>", "<m:e/></m:d>"),
            fence(FRACTION).replace('<m:grow m:val="1"/>', ""),
            fence(FRACTION + "<m:phant><m:e><m:r><m:t>keep</m:t></m:r></m:e></m:phant>"),
        ):
            with self.subTest(content=content[:100]):
                root = parse(content)
                before = etree.tostring(root)
                self.assertEqual(normalize_fraction_delimiters(root), 0)
                self.assertEqual(etree.tostring(root), before)

    def test_nested_fences_have_bounded_growth(self) -> None:
        nested = FRACTION
        for _ in range(40):
            nested = fence(nested)
        self.assert_clearance(parse(nested))

    def test_budget_rejects_before_mutating_enclosure(self) -> None:
        root = parse(fence(FRACTION + "<m:r><m:t>x</m:t></m:r>" * 5000))
        before = etree.tostring(root)
        with self.assertRaisesRegex(ValueError, "exceeds 10000 cloned XML elements"):
            normalize_fraction_delimiters(root)
        self.assertEqual(etree.tostring(root), before)

    def test_budget_is_total_for_one_pass(self) -> None:
        root = parse(fence(FRACTION * 800) * 2)
        before = etree.tostring(root[0])
        with self.assertRaisesRegex(ValueError, "exceeds 10000"):
            normalize_fraction_delimiters(root)
        self.assertEqual(etree.tostring(root[0]), before)
        self.assertEqual(len(list(root.iter(f"{M}phant"))), 1)


if __name__ == "__main__":
    unittest.main()
