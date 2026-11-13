"""Reuse the XML formula-wrapper contract before applying Word table headers."""

from typing import Any

from lxml import etree

from .constants import MATH_NS, WORD_NS
from .table_spacing import is_math_layout_table


def is_word_math_layout_table(table: Any) -> bool:
    if int(table.Range.OMaths.Count) == 0:
        return False
    root = etree.fromstring(str(table.Range.WordOpenXML).encode("utf-8"))
    namespace = {"w": WORD_NS, "m": MATH_NS}
    tables = root.xpath(".//w:document/w:body/w:tbl", namespaces=namespace)
    styles = root.find(f".//{{{WORD_NS}}}styles")
    if len(tables) != 1:
        raise RuntimeError("Word did not expose one table for formula-wrapper classification.")
    return is_math_layout_table(tables[0], namespace, styles)
