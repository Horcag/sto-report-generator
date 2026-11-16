"""Repair converter artifacts without changing intentional scripts or accent sizes."""

import re
from typing import Any

from lxml import etree

from .constants import MATH_NS

NS = {"m": MATH_NS}
NARY = re.compile(r"[∫∬∭∮∯∰∱∲∳∑∏]")
PRIME = re.compile(r"[\u2032\u2033\u2034\u2057']+")


def _child(node: Any, name: str) -> Any:
    return node.find(f"{{{MATH_NS}}}{name}")


def _empty(node: Any) -> bool:
    return not any(text.strip() for text in node.xpath(".//m:t/text()", namespaces=NS)) and all(
        child.tag in {f"{{{MATH_NS}}}{name}" for name in ("r", "rPr", "argPr", "ctrlPr")}
        for child in node
    )


def _nary_base(node: Any) -> bool:
    if node.tag == f"{{{MATH_NS}}}nary":
        return True
    if node.tag == f"{{{MATH_NS}}}r":
        return NARY.fullmatch("".join(node.itertext()).strip()) is not None
    if node.tag not in {f"{{{MATH_NS}}}limLow", f"{{{MATH_NS}}}limUpp"}:
        return False
    base = _child(node, "e")
    return base is not None and len(base) == 1 and _nary_base(base[0])


def normalize_script_structure(math: Any) -> None:
    for limit in reversed(math.xpath(".//m:limLow | .//m:limUpp", namespaces=NS)):
        index, base = _child(limit, "lim"), _child(limit, "e")
        if (
            index is not None
            and _empty(index)
            and base is not None
            and len(base) == 1
            and _nary_base(base[0])
        ):
            limit.getparent().replace(limit, base[0])
    for nary in math.xpath(".//m:nary", namespaces=NS):
        properties = _child(nary, "naryPr")
        for name in ("sub", "sup"):
            index = _child(nary, name)
            if index is None or not _empty(index):
                continue
            if properties is None:
                properties = etree.Element(f"{{{MATH_NS}}}naryPr")
                nary.insert(0, properties)
            hide = _child(properties, f"{name}Hide")
            if hide is None:
                hide = etree.Element(f"{{{MATH_NS}}}{name}Hide")
                following = next(
                    (
                        child
                        for child in properties
                        if (name == "sub" and child.tag == f"{{{MATH_NS}}}supHide")
                        or child.tag == f"{{{MATH_NS}}}ctrlPr"
                    ),
                    None,
                )
                properties.insert(
                    list(properties).index(following) if following is not None else len(properties),
                    hide,
                )
            hide.set(f"{{{MATH_NS}}}val", "1")
    for script in reversed(math.xpath(".//m:sSup", namespaces=NS)):
        base, superscript = _child(script, "e"), _child(script, "sup")
        parent = script.getparent()
        if (
            parent.tag == f"{{{MATH_NS}}}sup"
            and base is not None
            and _empty(base)
            and superscript is not None
            and all(child.tag == f"{{{MATH_NS}}}r" for child in superscript)
            and PRIME.fullmatch("".join(superscript.itertext()).strip())
        ):
            position = list(parent).index(script)
            parent.remove(script)
            for child in list(superscript):
                parent.insert(position, child)
                position += 1


def prepare_nary_operators(root: Any) -> dict[str, str]:
    """Isolate bare operator tokens using the converter's existing script pathway."""
    namespace = "http://www.w3.org/1998/Math/MathML"
    literals: dict[str, str] = {}
    prefix = "\ue200LITERAL"
    while prefix in "".join(root.itertext()):
        prefix += "X"
    for name in ("mtext", "mi", "mn", "ms", "mo"):
        for token in root.iter(f"{{{namespace}}}{name}"):
            if name == "mo" and not any(
                ancestor.tag == f"{{{namespace}}}mrow"
                and ancestor.get("data-latex", "").startswith(r"\operatorname{")
                for ancestor in token.iterancestors()
            ):
                continue
            text = ""
            for character in token.text or "":
                if NARY.fullmatch(character):
                    marker = f"{prefix}{len(literals)}\ue201"
                    literals[marker] = character
                    text += marker
                else:
                    text += character
            token.text = text
    scripted = {"munder", "mover", "munderover", "msub", "msup", "msubsup"}
    for operator in list(root.iter(f"{{{namespace}}}mo")):
        if not NARY.fullmatch((operator.text or "").strip()):
            continue
        base = operator
        while (
            base.getparent() is not None
            and base.getparent().tag == f"{{{namespace}}}mrow"
            and len(base.getparent()) == 1
        ):
            base = base.getparent()
        parent = base.getparent()
        if parent is not None and etree.QName(parent).localname in scripted and parent[0] is base:
            if etree.QName(parent).localname == "msup":
                parent.tag = f"{{{namespace}}}msubsup"
                parent.insert(1, etree.Element(f"{{{namespace}}}mrow"))
            continue
        wrapper = etree.Element(f"{{{namespace}}}msubsup")
        wrapper.tail, operator.tail = operator.tail, None
        operator.getparent().replace(operator, wrapper)
        wrapper.append(operator)
        etree.SubElement(wrapper, f"{{{namespace}}}mrow")
        etree.SubElement(wrapper, f"{{{namespace}}}mrow")

    return literals


def restore_literal_nary(value: str, literals: dict[str, str]) -> str:
    for marker, character in literals.items():
        value = value.replace(marker, character)
    return value


def normalize_limit_operators(root: Any) -> int:
    namespaces = {"m": MATH_NS}
    fixed = 0
    for run in root.xpath(".//m:limLow/m:e/m:r | .//m:limUpp/m:e/m:r", namespaces=namespaces):
        if "".join(run.xpath("./m:t/text()", namespaces=namespaces)).strip() not in {
            "min",
            "max",
            "lim",
            "inf",
            "sup",
        }:
            continue
        properties = run.find(f"{{{MATH_NS}}}rPr")
        if properties is None:
            properties = etree.Element(f"{{{MATH_NS}}}rPr")
            run.insert(0, properties)
        if properties.find(f"{{{MATH_NS}}}nor") is None:
            etree.SubElement(properties, f"{{{MATH_NS}}}nor")
            fixed += 1
    return fixed
