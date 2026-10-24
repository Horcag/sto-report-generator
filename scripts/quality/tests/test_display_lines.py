"""Keep post-build formula order/count aligned with generated display rows."""

import tempfile
import unittest
from pathlib import Path

from scripts.sto_post_build.markdown_formulas import (
    extract_markdown_formulas,
    split_display_math_lines,
)


class DisplayLineTests(unittest.TestCase):
    def test_top_level_continuations_and_outer_alignment(self) -> None:
        cases = [
            (r" x=a+\\+b=\\=c ", ["x=a+", "+b=", "=c"]),
            (r"\begin{aligned}x&=a+\\&+b\end{aligned},", ["x=a+", "+b,"]),
            (r"\begin{gathered}x=a;\\y=b\end{gathered}.", ["x=a;", "y=b."]),
            (r"\begin{aligned}x&=a\end{aligned}", ["x=a"]),
        ]
        for source, expected in cases:
            with self.subTest(source=source):
                self.assertEqual(split_display_math_lines(source), expected)

    def test_nested_matrices_and_cases_remain_one_expression_per_outer_line(self) -> None:
        matrix = r"\begin{bmatrix}1&2\\3&4\end{bmatrix}"
        cases = r"\begin{cases}a&x>0\\b&x<0\end{cases}"
        for outer in ("aligned", "gathered"):
            with self.subTest(outer=outer):
                source = rf"\begin{{{outer}}}x&={matrix}\\&={cases}\\&=z\end{{{outer}}};"
                self.assertEqual(
                    split_display_math_lines(source), [f"x={matrix}", f"={cases}", "=z;"]
                )
        self.assertEqual(split_display_math_lines(matrix), [matrix])
        self.assertEqual(split_display_math_lines(cases), [cases])

    def test_braced_rows_do_not_split(self) -> None:
        source = r"\begin{aligned}x&=\text{a\\b&c}\\&=\frac{{a\\b}}{c}\end{aligned}"
        self.assertEqual(
            split_display_math_lines(source), [r"x=\text{a\\b&c}", r"=\frac{{a\\b}}{c}"]
        )

    def test_escaped_braces_and_ampersands_do_not_change_nesting(self) -> None:
        source = r"\begin{aligned}\{x\}&=a\&b\\&=c\end{aligned}"
        self.assertEqual(split_display_math_lines(source), [r"\{x\}=a\&b", "=c"])

    def test_unwrapped_ampersands_and_nested_alignment_are_preserved(self) -> None:
        source = r"x&=\begin{aligned}a&=b\\c&=d\end{aligned}\\&=z"
        self.assertEqual(
            split_display_math_lines(source),
            [r"x&=\begin{aligned}a&=b\\c&=d\end{aligned}", "&=z"],
        )

    def test_adjacent_environments_are_not_unwrapped_as_one(self) -> None:
        first = r"\begin{aligned}a&=b\\c&=d\end{aligned}"
        second = r"\begin{aligned}e&=f\\g&=h\end{aligned}"
        self.assertEqual(split_display_math_lines(first + second), [first + second])
        self.assertEqual(split_display_math_lines(first + r"\\" + second), [first, second])

    def test_nested_alignment_unwraps_only_the_outer_environment(self) -> None:
        inner = r"\begin{aligned}a&=b\\c&=d\end{aligned}"
        source = r"\begin{aligned}x&=" + inner + r"\\&=z\end{aligned}."
        self.assertEqual(split_display_math_lines(source), [f"x={inner}", "=z."])

    def test_comment_cannot_add_fake_continuation_or_math(self) -> None:
        source = "x=a% ignored \\\\ x=999\n+b"
        self.assertEqual(split_display_math_lines(source), ["x=a\n+b"])
        self.assertEqual(split_display_math_lines("x=a% ignored to end"), ["x=a"])

    def test_comment_braces_and_environment_tokens_do_not_change_nesting(self) -> None:
        source = (
            r"\begin{aligned}x&=a% } \\ \end{aligned} \begin{cases} x=999"
            + "\r\n"
            + r"\\&+b\end{aligned}."
        )
        self.assertEqual(split_display_math_lines(source), ["x=a", "+b."])

    def test_escaped_percent_is_retained_and_even_backslashes_do_not_escape_comment(self) -> None:
        self.assertEqual(split_display_math_lines(r"x=1\%+a\\+b"), [r"x=1\%+a", "+b"])
        self.assertEqual(split_display_math_lines("x=a\\\\% ignored x=999\n+b"), ["x=a", "+b"])
        self.assertEqual(split_display_math_lines(r"x=a\% x=999"), [r"x=a\% x=999"])

    def test_outer_alignment_and_top_level_line_options_fail(self) -> None:
        cases = [
            (r"\begin{aligned}[t]a&=b\end{aligned}", "alignment options"),
            (r"\begin{gathered} [b] a=b\end{gathered}", "alignment options"),
            (r"a=b\\[2pt]c=d", "line spacing options"),
            ("a=b\\\\ \n[2pt]c=d", "line spacing options"),
            (r"\begin{aligned}a&=b\\[2pt]&=c\end{aligned}", "line spacing options"),
        ]
        for source, message in cases:
            with self.subTest(source=source), self.assertRaisesRegex(RuntimeError, message):
                split_display_math_lines(source)
        matrix = r"\begin{matrix}a&b\\[2pt]c&d\end{matrix}"
        self.assertEqual(split_display_math_lines(matrix), [matrix])

    def test_extraction_drops_display_comment_before_counting_rows(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sto-display-comment-") as temporary:
            root = Path(temporary)
            (root / "10_math.md").write_text(
                "$$x=a% ignored \\\\ x=999\n+b, (@eq:value)$$", encoding="utf-8"
            )
            self.assertEqual(extract_markdown_formulas(root), ["x=a\n+b,"])

    def test_empty_continuation_lines_fail(self) -> None:
        for source in (
            "",
            " ",
            r"\\x=a",
            r"x=a\\",
            r"x=a\\ \\\\b",
            r"\begin{aligned}x&=a\\&\end{aligned}",
        ):
            with (
                self.subTest(source=source),
                self.assertRaisesRegex(RuntimeError, "empty continuation"),
            ):
                split_display_math_lines(source)

    def test_extraction_expands_display_only_in_source_order(self) -> None:
        inline = r"\begin{matrix}a&b\\c&d\end{matrix}"
        with tempfile.TemporaryDirectory(prefix="sto-display-lines-") as temporary:
            root = Path(temporary)
            (root / "10_math.md").write_text(
                "---\nexample: $ignored$\n---\n"
                + f"Inline ${inline}$.\n\n"
                + r"$$\begin{aligned}x&=a+\\&+b\end{aligned}, (@eq:sum)$$"
                + "\n\n$z_i$\n\n"
                + r"$$p=q\\=r (2)$$",
                encoding="utf-8",
            )
            (root / "20_math.md").write_text(r"$$v=w.$$", encoding="utf-8")
            self.assertEqual(
                extract_markdown_formulas(root), [inline, "x=a+", "+b,", "z_i", "p=q", "=r", "v=w."]
            )

    def test_nonbreaking_row_modifier_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "nonbreaking row modifiers"):
            split_display_math_lines(r"a=b\\*+c")

    def test_extraction_rejects_empty_display_line(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sto-display-invalid-") as temporary:
            root = Path(temporary)
            (root / "10_math.md").write_text(r"$$x=a\\ (@eq:value)$$", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "empty continuation"):
                extract_markdown_formulas(root)


if __name__ == "__main__":
    unittest.main()
