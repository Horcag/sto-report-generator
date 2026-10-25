"""Separate report tables from following text without inserting empty paragraphs."""

import re
from typing import Any

from lxml import etree

from .constants import MATH_NS, TABLE_AFTER_SPACING_TWIPS, WORD_NS

WORD = f"{{{WORD_NS}}}"


def element_text(element: Any) -> str:
    return "".join(element.xpath(".//w:t/text()", namespaces={"w": WORD_NS})).strip()


def is_math_layout_table(element: Any, namespace: dict[str, str], styles_root: Any = None) -> bool:
    """Recognize formula wrappers, including adjacent wrappers merged by Word."""
    if element.tag != f"{WORD}tbl" or element.xpath(
        ".//w:tbl | .//w:drawing | .//w:tblHeader", namespaces=namespace
    ):
        return False
    rows = element.findall(f"{WORD}tr")
    if not rows:
        return False
    for row in rows:
        cells = row.findall(f"{WORD}tc")
        if len(cells) != 3:
            return False
        left, formula, right = cells
        if (
            element_text(left)
            or element_text(formula)
            or not formula.xpath(".//m:oMath", namespaces=namespace)
            or not any(
                formula_paragraph_is_centered(paragraph, styles_root)
                for paragraph in formula.findall(f"{WORD}p")
            )
            or left.xpath(".//m:oMath", namespaces=namespace)
            or right.xpath(".//m:oMath", namespaces=namespace)
        ):
            return False
        number = element_text(right)
        if (
            number
            and re.fullmatch(r"\((?:[A-Z\u0410-\u042f\u0401]\.)?\d+(?:\.\d+)*\)", number) is None
        ):
            return False
    borders = element.xpath(".//w:tblBorders/* | .//w:tcBorders/*", namespaces=namespace)
    return all(border.get(f"{WORD}val") in {"none", "nil"} for border in borders)


def is_data_table(element: Any, namespace: dict[str, str], styles_root: Any = None) -> bool:
    return element.tag == f"{WORD}tbl" and not is_math_layout_table(element, namespace, styles_root)


def effective_paragraph_attribute(
    paragraph: Any, styles: Any, container: str, attribute: str
) -> str | None:
    key = f"{WORD}{attribute}"
    spacing = paragraph.find(f"{WORD}pPr/{WORD}{container}")
    if spacing is not None and spacing.get(key) is not None:
        return str(spacing.get(key))
    style = paragraph.find(f"{WORD}pPr/{WORD}pStyle")
    style_id = style.get(f"{WORD}val") if style is not None else "Normal"
    seen = set()
    while styles is not None and style_id and style_id not in seen:
        seen.add(style_id)
        candidates = styles.xpath(
            "./w:style[@w:styleId=$id]", namespaces={"w": WORD_NS}, id=style_id
        )
        if not candidates:
            break
        current = candidates[0]
        spacing = current.find(f"{WORD}pPr/{WORD}{container}")
        if spacing is not None and spacing.get(key) is not None:
            return str(spacing.get(key))
        parent = current.find(f"{WORD}basedOn")
        style_id = parent.get(f"{WORD}val") if parent is not None else None
    if styles is not None:
        spacing = styles.find(f"{WORD}docDefaults/{WORD}pPrDefault/{WORD}pPr/{WORD}{container}")
        if spacing is not None:
            value = spacing.get(key)
            return str(value) if value is not None else None
    return None


def formula_paragraph_is_centered(paragraph: Any, styles: Any = None) -> bool:
    direct = paragraph.find(f"{WORD}pPr/{WORD}jc")
    if direct is not None:
        return direct.get(f"{WORD}val") == "center"
    effective = effective_paragraph_attribute(paragraph, styles, "jc", "val")
    if effective is not None:
        return effective == "center"
    marker = paragraph.find(f"{WORD}pPr/{WORD}pStyle")
    return marker is not None and marker.get(f"{WORD}val") in {"Formula", "MTDisplayEquation"}


def add_spacing_after_data_tables(document_root: Any, styles_root: Any = None) -> int:
    namespace = {"m": MATH_NS, "w": WORD_NS}
    body = document_root.find(f"{WORD}body")
    if body is None:
        return 0
    elements = list(body)
    start = next(
        (i for i, element in enumerate(elements) if element_text(element) == "РЕФЕРАТ"), -1
    )
    changed = 0
    for index, table in enumerate(elements):
        if index < start or not is_data_table(table, namespace, styles_root):
            continue
        if start < 0 and (
            index == 0
            or not re.match(
                r"^(?:Таблица|Продолжение таблицы)\s", element_text(elements[index - 1])
            )
        ):
            continue
        following = elements[index + 1] if index + 1 < len(elements) else None
        if following is None or following.tag != f"{WORD}p":
            continue
        if element_text(following).startswith("Продолжение таблицы ") or (
            not element_text(following)
            and not following.xpath(".//w:drawing", namespaces=namespace)
        ):
            continue
        before = effective_paragraph_attribute(following, styles_root, "spacing", "before")
        before_lines = effective_paragraph_attribute(
            following, styles_root, "spacing", "beforeLines"
        )
        automatic = effective_paragraph_attribute(
            following, styles_root, "spacing", "beforeAutospacing"
        )
        if (
            float(before or 0) >= int(TABLE_AFTER_SPACING_TWIPS)
            or float(before_lines or 0) > 0
            or automatic in {"1", "true", "on"}
        ):
            continue
        properties = following.find(f"{WORD}pPr")
        if properties is None:
            properties = etree.Element(f"{WORD}pPr")
            following.insert(0, properties)
        marker = properties.find(f"{WORD}pStyle")
        style_id = marker.get(f"{WORD}val") if marker is not None else "Normal"
        if (
            style_id == "Normal"
            and styles_root is not None
            and styles_root.xpath(
                './w:style[@w:styleId="TableFollowingText"]', namespaces=namespace
            )
        ):
            if marker is None:
                marker = etree.Element(f"{WORD}pStyle")
                properties.insert(0, marker)
            marker.set(f"{WORD}val", "TableFollowingText")
        spacing = properties.find(f"{WORD}spacing")
        if spacing is None:
            spacing = etree.Element(f"{WORD}spacing")
            later = {
                "ind",
                "contextualSpacing",
                "mirrorIndents",
                "suppressOverlap",
                "jc",
                "textDirection",
                "textAlignment",
                "textboxTightWrap",
                "outlineLvl",
                "divId",
                "cnfStyle",
                "rPr",
                "sectPr",
                "pPrChange",
            }
            position = next(
                (i for i, item in enumerate(properties) if etree.QName(item).localname in later),
                len(properties),
            )
            properties.insert(position, spacing)
        spacing.set(f"{WORD}before", TABLE_AFTER_SPACING_TWIPS)
        changed += 1
    return changed
