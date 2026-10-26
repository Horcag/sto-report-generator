"""Repair the converter's empty integral arguments without consuming an expression."""

import unicodedata
from typing import Any

from .constants import MATH_NS

INTEGRAL_CHARS = {"∫", "∬", "∭", "∮", "∯", "∰", "∱", "∲", "∳"}
SCRIPT_OPERANDS = {"sSup", "sSub", "sSubSup", "acc", "bar", "rad"}
GROUP_OPERANDS = {"f", "d", "func", "m"}


def _is_integral_operand(element: Any) -> bool:
    if not isinstance(element.tag, str) or not element.tag.startswith(f"{{{MATH_NS}}}"):
        return False
    name = element.tag.removeprefix(f"{{{MATH_NS}}}")
    text = "".join(element.itertext()).strip()
    if name == "r":
        return bool(text) and all(unicodedata.category(char)[0] in "LNM" for char in text)
    if name in GROUP_OPERANDS:
        return any(unicodedata.category(char)[0] in "LN" for char in text)
    if name in SCRIPT_OPERANDS or name == "nary":
        base = element.find(f"{{{MATH_NS}}}e")
        return base is not None and len(base) > 0 and _is_integral_operand(base[0])
    return False


def normalize_empty_integral_arguments(root: Any) -> int:
    fixed = 0
    # Reverse order lets consecutive/nested integrals acquire their operand first.
    for integral in reversed(list(root.iter(f"{{{MATH_NS}}}nary"))):
        character = integral.find(f"{{{MATH_NS}}}naryPr/{{{MATH_NS}}}chr")
        if character is None or character.get(f"{{{MATH_NS}}}val") not in INTEGRAL_CHARS:
            continue
        argument = integral.find(f"{{{MATH_NS}}}e")
        operand = integral.getnext()
        if argument is None or len(argument) or (argument.text or "").strip() or operand is None:
            continue
        if _is_integral_operand(operand):
            argument.append(operand)
            fixed += 1
    return fixed
