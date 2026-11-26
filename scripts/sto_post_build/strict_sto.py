"""Restore marked strict documents after native Word field/layout updates."""

import os
import re
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
CUSTOM_NS = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
VALUE_NS = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
W = f"{{{WORD_NS}}}"
NS = {"w": WORD_NS, "m": MATH_NS}
STRICT_STO_PART = re.compile(
    r"word/(?:document|styles|numbering|header\d*|footer\d*|footnotes|endnotes)\.xml"
)
# Same schema order as src/shared/lib/strict-sto/xml.ts.
ORDER = {
    "styles": ["docDefaults", "latentStyles", "style"],
    "style": [
        "name",
        "aliases",
        "basedOn",
        "next",
        "link",
        "autoRedefine",
        "hidden",
        "uiPriority",
        "semiHidden",
        "unhideWhenUsed",
        "qFormat",
        "locked",
        "personal",
        "personalCompose",
        "personalReply",
        "rsid",
        "pPr",
        "rPr",
        "tblPr",
        "trPr",
        "tcPr",
        "tblStylePr",
    ],
    "docDefaults": ["rPrDefault", "pPrDefault"],
    "lvl": [
        "start",
        "numFmt",
        "lvlRestart",
        "pStyle",
        "isLgl",
        "suff",
        "lvlText",
        "lvlPicBulletId",
        "legacy",
        "lvlJc",
        "pPr",
        "rPr",
    ],
    "rPr": [
        "rStyle",
        "rFonts",
        "b",
        "bCs",
        "i",
        "iCs",
        "caps",
        "smallCaps",
        "strike",
        "dstrike",
        "outline",
        "shadow",
        "emboss",
        "imprint",
        "noProof",
        "snapToGrid",
        "vanish",
        "webHidden",
        "color",
        "spacing",
        "w",
        "kern",
        "position",
        "sz",
        "szCs",
        "highlight",
        "u",
        "effect",
        "bdr",
        "shd",
        "fitText",
        "vertAlign",
        "rtl",
        "cs",
        "em",
        "lang",
        "eastAsianLayout",
        "specVanish",
        "oMath",
        "rPrChange",
    ],
    "pPr": [
        "pStyle",
        "keepNext",
        "keepLines",
        "pageBreakBefore",
        "framePr",
        "widowControl",
        "numPr",
        "suppressLineNumbers",
        "pBdr",
        "shd",
        "tabs",
        "suppressAutoHyphens",
        "kinsoku",
        "wordWrap",
        "overflowPunct",
        "topLinePunct",
        "autoSpaceDE",
        "autoSpaceDN",
        "bidi",
        "adjustRightInd",
        "snapToGrid",
        "spacing",
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
    ],
}


def is_strict_sto_docx(docx_path: str | Path) -> bool:
    with ZipFile(docx_path) as archive:
        if "docProps/custom.xml" not in archive.namelist():
            return False
        root = etree.fromstring(archive.read("docProps/custom.xml"))
    return any(
        prop.get("name") == "STOStylePreset"
        and prop.findtext(f"{{{VALUE_NS}}}lpwstr") == "sto-strict"
        for prop in root.findall(f"{{{CUSTOM_NS}}}property")
    )


def _child(parent, name):
    node = parent.find(W + name)
    if node is None:
        node = etree.Element(W + name)
        order = ORDER.get(etree.QName(parent).localname, [])
        rank = order.index(name) if name in order else -1
        for index, candidate in enumerate(parent):
            candidate_name = etree.QName(candidate).localname
            candidate_rank = order.index(candidate_name) if candidate_name in order else -1
            if (rank < 0 and name in {"pPr", "rPr"}) or candidate_rank > rank >= 0:
                parent.insert(index, node)
                break
        else:
            parent.append(node)
    return node


def _in_math(node):
    return any(etree.QName(parent).namespace == MATH_NS for parent in (node, *node.iterancestors()))


def _run_properties(properties):
    fonts = _child(properties, "rFonts")
    for attribute in list(fonts.attrib):
        del fonts.attrib[attribute]
    for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(W + attribute, "Times New Roman")
    color = _child(properties, "color")
    color.attrib.clear()
    color.set(W + "val", "000000")
    for name, value in (("sz", "28"), ("szCs", "28"), ("b", "0"), ("bCs", "0")):
        _child(properties, name).set(W + "val", value)


def _spacing(properties, caption=False):
    spacing = _child(properties, "spacing")
    spacing.set(W + "line", "240" if caption else "360")
    spacing.set(W + "lineRule", "auto")


def _style_kind(style_id, styles):
    visited = set()
    while style_id and style_id not in visited:
        visited.add(style_id)
        if style_id == "TableCaption":
            return "caption"
        if style_id in {"Formula", "MTDisplayEquation"}:
            return "math"
        style = styles.get(style_id)
        if style is None:
            break
        name = style.find(W + "name")
        display_name = name.get(W + "val") if name is not None else None
        if display_name in {"Table Caption", "+№ - Название таблицы"}:
            return "caption"
        if display_name == "Display Equation":
            return "math"
        based_on = style.find(W + "basedOn")
        style_id = based_on.get(W + "val") if based_on is not None else None
    return "ordinary"


def _caption(style_id, styles):
    return _style_kind(style_id, styles) == "caption"


def _math_style(style_id, styles):
    return _style_kind(style_id, styles) == "math"


def _courier_run(run, paragraph_style, styles):
    direct = run.find(W + "rPr/" + W + "rFonts")
    if direct is not None and direct.get(W + "ascii"):
        return "courier" in direct.get(W + "ascii", "").lower()
    run_style = run.find(W + "rPr/" + W + "rStyle")
    for initial in (run_style.get(W + "val") if run_style is not None else None, paragraph_style):
        seen = set()
        current = initial
        while current in styles and current not in seen:
            seen.add(current)
            style = styles[current]
            fonts = style.find(W + "rPr/" + W + "rFonts")
            if fonts is not None and fonts.get(W + "ascii"):
                return "courier" in fonts.get(W + "ascii", "").lower()
            based_on = style.find(W + "basedOn")
            current = based_on.get(W + "val") if based_on is not None else None
    return False


def normalize_strict_sto_docx(docx_path: str | Path) -> int:
    """Normalize textual WML only; unmarked packages remain byte-identical."""
    if not is_strict_sto_docx(docx_path):
        return 0
    from .table_spacing import is_math_layout_table

    with ZipFile(docx_path) as archive:
        entries = archive.infolist()
        parts = {entry.filename: archive.read(entry) for entry in entries}
    styles_root = etree.fromstring(parts["word/styles.xml"]) if "word/styles.xml" in parts else None
    styles = (
        {style.get(W + "styleId"): style for style in styles_root.findall(W + "style")}
        if styles_root is not None
        else {}
    )
    changed = 0
    for name, data in list(parts.items()):
        if not STRICT_STO_PART.fullmatch(name):
            continue
        root = etree.fromstring(data)
        math_tables = {
            table for table in root.iter(W + "tbl") if is_math_layout_table(table, NS, styles_root)
        }
        for paragraph in root.iter(W + "p"):
            if _in_math(paragraph):
                continue
            runs = [
                run
                for run in paragraph.iter(W + "r")
                if not _in_math(run)
                and next((parent for parent in run.iterancestors() if parent.tag == W + "p"), None)
                is paragraph
                and run.xpath("./w:t | ./w:instrText", namespaces=NS)
            ]
            if not runs:
                continue
            properties = paragraph.find(W + "pPr")
            style = properties.find(W + "pStyle") if properties is not None else None
            style_id = style.get(W + "val") if style is not None else "Normal"
            code = all(_courier_run(run, style_id, styles) for run in runs)
            if properties is None:
                properties = etree.Element(W + "pPr")
                paragraph.insert(0, properties)
            math_spacing = (
                _math_style(style_id, styles)
                or any(p in math_tables for p in paragraph.iterancestors())
                or (
                    paragraph.find(".//m:oMath", NS) is not None
                    and not any(
                        (text.text or "").strip()
                        for text in paragraph.iter(W + "t")
                        if not _in_math(text)
                    )
                )
            )
            if not math_spacing:
                _spacing(properties, _caption(style_id, styles))
            if code:
                _child(properties, "pStyle").set(W + "val", "Normal")
                _child(properties, "jc").set(W + "val", "both")
                indent = _child(properties, "ind")
                for attribute in ("hanging", "firstLineChars", "leftChars", "hangingChars"):
                    indent.attrib.pop(W + attribute, None)
                indent.set(W + "left", "0")
                indent.set(W + "firstLine", "709")
            for run in runs:
                properties = run.find(W + "rPr")
                if properties is None:
                    properties = etree.Element(W + "rPr")
                    run.insert(0, properties)
                _run_properties(properties)
        # Defaults, inherited styles and numbering labels must not restore bold.
        for properties in root.iter(W + "rPr"):
            if not _in_math(properties) and not any(
                p.tag == W + "r" for p in properties.iterancestors()
            ):
                _run_properties(properties)
        for level in root.iter(W + "lvl"):
            if not _in_math(level):
                _run_properties(_child(level, "rPr"))
        if name == "word/styles.xml":
            defaults = _child(root, "docDefaults")
            _run_properties(_child(_child(defaults, "rPrDefault"), "rPr"))
            _spacing(_child(_child(defaults, "pPrDefault"), "pPr"))
            for style in root.findall(W + "style"):
                _run_properties(_child(style, "rPr"))
                if style.get(W + "type") == "paragraph" and not _math_style(
                    style.get(W + "styleId"), styles
                ):
                    _spacing(_child(style, "pPr"), _caption(style.get(W + "styleId"), styles))
        serialized = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        # Serialization alone must not rewrite unrelated parts.
        if etree.tostring(etree.fromstring(data)) != etree.tostring(root):
            parts[name] = serialized
            changed += 1
    if not changed:
        return 0
    descriptor, temporary = tempfile.mkstemp(suffix=".docx", dir=Path(docx_path).parent)
    os.close(descriptor)
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as output:
            for entry in entries:
                output.writestr(entry, parts[entry.filename])
        os.replace(temporary, docx_path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return changed


if __name__ == "__main__":
    # Package import resolves the existing layout classifier without loading COM.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sto_post_build.process_ownership import record_process
    from sto_post_build.strict_sto import normalize_strict_sto_docx as normalize

    record_process(os.getpid(), "post-build-python")
    normalize(sys.argv[1])
