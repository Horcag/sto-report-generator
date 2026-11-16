"""Negative controls for the native formula geometry regression checker."""

# ruff: noqa: RUF001
# Intentional PDF math glyphs exercise Unicode normalization and character geometry.

import copy
import unittest

from scripts.quality.check_formula_pdf import inspect_rendering_edges


class Page:
    def __init__(self):
        self.lines = [
            "𝑦∈[0,4081𝐻;0,9919𝐻), 𝑥∈[0,0359𝑊;0,9641𝑊),",
            "𝑦∈[0,3324𝐻;0,9135𝐻), 𝑥∈[0,0359𝑊;0,9641𝑊).",
            "𝑗∈{1,2,3}.",
        ]
        self.domain_baseline = 200
        self.characters = [{"c": "𝛿", "origin": (50, 200), "bbox": (50, 190, 60, 200)}]
        for baseline in (100, 150):
            self.characters.extend(
                [
                    {
                        "c": "𝐼",
                        "origin": (100, baseline),
                        "bbox": (100, baseline - 10, 105, baseline),
                    },
                    {
                        "c": "′",
                        "origin": (106, baseline - 5),
                        "bbox": (106, baseline - 10, 109, baseline - 4),
                    },
                ]
            )

    def get_text(self, kind):
        if kind == "dict":
            lines = [
                {"spans": [{"text": text, "origin": (0, self.domain_baseline)}]}
                for text in self.lines
            ]
        else:
            lines = [{"spans": [{"chars": self.characters}]}]
        return {"blocks": [{"lines": lines}]}


class FormulaEdgesPdfTests(unittest.TestCase):
    def test_all_cases_discovered(self):
        result = inspect_rendering_edges([Page()])
        self.assertEqual(result["prime_gaps_pt"], [1, 1])
        self.assertEqual(len(result["crop_rows"]), 2)
        self.assertEqual(result["threshold_domain_pages"], [1])

    def test_crop_wrap_detected(self):
        page = Page()
        page.lines[0] = "𝑦∈[0,4081𝐻;0,9919𝐻), 𝑥∈"
        with self.assertRaisesRegex(AssertionError, "wrapped away"):
            inspect_rendering_edges([page])

    def test_detached_prime_detected(self):
        page = Page()
        page.characters[2]["bbox"] = (115, 90, 118, 96)
        with self.assertRaisesRegex(AssertionError, "Prime-to-base gap"):
            inspect_rendering_edges([page])

    def test_threshold_wrap_detected(self):
        page = Page()
        page.lines[-1:] = ["𝑗∈", "∈{1,2,3}."]
        with self.assertRaisesRegex(AssertionError, "Missing or duplicated"):
            inspect_rendering_edges([page])

    def test_whole_threshold_domain_wrap_detected(self):
        page = Page()
        page.domain_baseline += 20
        with self.assertRaisesRegex(AssertionError, "delta baseline"):
            inspect_rendering_edges([page])

    def test_missing_and_duplicate_cases_detected(self):
        for change in (
            lambda page: page.lines.pop(0),
            lambda page: page.lines.append(page.lines[0]),
        ):
            page = Page()
            change(page)
            with self.assertRaisesRegex(AssertionError, "exactly two crop"):
                inspect_rendering_edges([page])
        page = Page()
        page.characters.extend(copy.deepcopy(page.characters))
        with self.assertRaisesRegex(AssertionError, "Missing or duplicated"):
            inspect_rendering_edges([page])
