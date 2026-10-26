"""Bounded normal-text matrix baseline policy, mirrored by matrix-spacing.ts."""

import json
import math
import re
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS

MATHML_NS = "http://www.w3.org/1998/Math/MathML"
FONT_SIZE_POINTS = json.loads(
    (Path(__file__).resolve().parents[2] / "src/shared/config/sto-rules.json").read_text(
        encoding="utf-8"
    )
)["typography"]["fontSizePoints"]
SIZE_CONTEXTS = {
    f"{{{MATHML_NS}}}{name}"
    for name in (
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
    )
}


def has_normal_matrix_size(matrix: Any) -> bool:
    for node in (matrix, *matrix.iterancestors()):
        if not node.tag.startswith(f"{{{MATHML_NS}}}"):
            continue
        if (
            node.tag in SIZE_CONTEXTS
            or "mathsize" in node.attrib
            or ("scriptlevel" in node.attrib and node.get("scriptlevel") != "0")
        ):
            return False
    return True


def matrix_min_row_baseline_twips(matrix: Any) -> int | None:
    if not has_normal_matrix_size(matrix):
        return None
    values = matrix.get("rowspacing", "").split()
    if not values or any(re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)pt", v) is None for v in values):
        return None
    gaps = [float(value[:-2]) for value in values]
    if any(not math.isfinite(gap) or gap != gaps[0] for gap in gaps):
        return None
    # TeX-style 1.2em strut policy, not exact MathML gap conversion. Word uses
    # rSpRule=3 as minimum baseline distance in TWIPS (MS-OI29500 Word implementation note for rSp).
    twips = (1.2 * FONT_SIZE_POINTS + gaps[0]) * 20
    if not math.isfinite(twips) or twips > 2**53 - 1:
        return None
    return math.floor(twips + 0.5)


def matrix_column_gap_twips(matrix: Any) -> int | None:
    if not has_normal_matrix_size(matrix):
        return None
    values = matrix.get("columnspacing", "").split()
    if not values:
        return None
    gaps = []
    for value in values:
        match = re.fullmatch(r"(\d+(?:\.\d*)?|\.\d+)(em|pt)", value)
        if match is None:
            return None
        gaps.append(float(match[1]) * (FONT_SIZE_POINTS if match[2] == "em" else 1))
    if any(not math.isfinite(gap) or gap != gaps[0] for gap in gaps):
        return None
    twips = gaps[0] * 20
    if not math.isfinite(twips) or twips > 2**53 - 1:
        return None
    return math.floor(twips + 0.5)


PROPERTY_ORDER = ("baseJc", "plcHide", "rSpRule", "cGpRule", "rSp", "cSp", "cGp", "mcs", "ctrlPr")


def restore_spacing(properties: Any, rule: str, spacing: str, twips: int) -> None:
    for name in (rule, spacing):
        for old in properties.findall(f"{{{MATH_NS}}}{name}"):
            properties.remove(old)
    for name, value in ((rule, "3"), (spacing, str(twips))):
        following_tags = {
            f"{{{MATH_NS}}}{tag}" for tag in PROPERTY_ORDER[PROPERTY_ORDER.index(name) + 1 :]
        }
        following = next((child for child in properties if child.tag in following_tags), None)
        index = properties.index(following) if following is not None else len(properties)
        prop = etree.Element(f"{{{MATH_NS}}}{name}")
        prop.set(f"{{{MATH_NS}}}val", value)
        properties.insert(index, prop)


def restore_matrix_row_spacing(properties: Any, twips: int) -> None:
    restore_spacing(properties, "rSpRule", "rSp", twips)


def restore_matrix_column_spacing(properties: Any, twips: int) -> None:
    # Word cGpRule=3 expresses the column gap directly in TWIPS.
    restore_spacing(properties, "cGpRule", "cGp", twips)


def matrix_spacing_metadata(matrix: Any) -> dict[str, int]:
    values = {
        "minRowBaselineTwips": matrix_min_row_baseline_twips(matrix),
        "columnGapTwips": matrix_column_gap_twips(matrix),
    }
    return {key: value for key, value in values.items() if value is not None}


def restore_matrix_spacing(properties: Any, expected: dict[str, Any]) -> None:
    if "minRowBaselineTwips" in expected:
        restore_matrix_row_spacing(properties, expected["minRowBaselineTwips"])
    if "columnGapTwips" in expected:
        restore_matrix_column_spacing(properties, expected["columnGapTwips"])
