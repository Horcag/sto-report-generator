"""Add bounded hidden clearance to scalable fraction enclosures."""

from copy import deepcopy
from typing import Any

from lxml import etree

from .constants import MATH_NS

MAX_CLONED_ELEMENTS = 10_000
TRUE_VALUES = {"1", "true", "on"}
M = f"{{{MATH_NS}}}"


def normalize_fraction_delimiters(root: Any) -> int:
    """Preserve visible operands; skip matrices and already adjusted enclosures."""
    fixed = 0
    cloned_elements = 0
    # Snapshot first: inner additions prevent copying their enclosing delimiter.
    for delimiter in reversed(list(root.iter(f"{M}d"))):
        properties = delimiter.find(f"{M}dPr")
        arguments = delimiter.findall(f"{M}e")
        if properties is None or len(arguments) != 1 or arguments[0].find(f"{M}argPr") is not None:
            continue
        grow = properties.find(f"{M}grow")
        begin = properties.find(f"{M}begChr")
        end = properties.find(f"{M}endChr")
        if (
            grow is None
            or grow.get(f"{M}val") not in TRUE_VALUES
            or (
                begin is not None
                and end is not None
                and begin.get(f"{M}val") == end.get(f"{M}val") == ""
            )
            or delimiter.find(f".//{M}f") is None
            or delimiter.find(f".//{M}m") is not None
            or delimiter.find(f".//{M}phant") is not None
        ):
            continue
        argument = arguments[0]
        count = sum(1 for node in argument.iterdescendants() if isinstance(node.tag, str))
        if cloned_elements + count > MAX_CLONED_ELEMENTS:
            raise ValueError(
                f"Fraction delimiter clearance exceeds {MAX_CLONED_ELEMENTS} cloned XML elements."
            )
        phantom = etree.Element(f"{M}phant")
        phantom_properties = etree.SubElement(phantom, f"{M}phantPr")
        etree.SubElement(phantom_properties, f"{M}show", {f"{M}val": "0"})
        etree.SubElement(phantom_properties, f"{M}zeroWid", {f"{M}val": "1"})
        phantom_base = etree.SubElement(phantom, f"{M}e")
        box = etree.SubElement(phantom_base, f"{M}box")
        box_base = etree.SubElement(box, f"{M}e")
        argument_properties = etree.SubElement(box_base, f"{M}argPr")
        etree.SubElement(argument_properties, f"{M}argSz", {f"{M}val": "1"})
        argument_properties.tail = argument.text
        for child in argument:
            box_base.append(deepcopy(child))
        argument.append(phantom)
        cloned_elements += count
        fixed += 1
    return fixed
