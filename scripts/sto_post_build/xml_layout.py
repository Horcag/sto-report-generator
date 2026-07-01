import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, SPACING_AFTER_TABLE_TWIPS, WORD_NS
from .docx_package import read_docx_part, rewrite_docx_part
from .models import DocumentCounts

WORD = f"{{{WORD_NS}}}"
SIGNATURE_COLUMN_WIDTHS = ("4263", "2916", "1675")


def paragraph_style(paragraph: Any) -> str:
    namespace = {"w": WORD_NS}
    values = paragraph.xpath("./w:pPr/w:pStyle/@w:val", namespaces=namespace)
    return values[0] if values else ""


def paragraph_has_visible_content(paragraph: Any) -> bool:
    namespace = {"w": WORD_NS}
    text = "".join(paragraph.xpath(".//w:t/text()", namespaces=namespace)).strip()
    has_drawing = bool(paragraph.xpath(".//w:drawing", namespaces=namespace))
    return bool(text or has_drawing)


def element_text(element: Any) -> str:
    namespace = {"w": WORD_NS}
    return "".join(element.xpath(".//w:t/text()", namespaces=namespace)).strip()


def report_body_elements(elements: list[Any]) -> list[Any]:
    for index, element in enumerate(elements):
        if element.tag == f"{{{WORD_NS}}}p" and element_text(element).upper() == "РЕФЕРАТ":
            return elements[index:]
    return elements


def set_paragraph_space_before(paragraph: Any, value: str) -> None:
    paragraph_properties = paragraph.find(f"{{{WORD_NS}}}pPr")
    if paragraph_properties is None:
        paragraph_properties = etree.Element(f"{{{WORD_NS}}}pPr")
        paragraph.insert(0, paragraph_properties)

    spacing = paragraph_properties.find(f"{{{WORD_NS}}}spacing")
    if spacing is None:
        spacing = etree.Element(f"{{{WORD_NS}}}spacing")
        paragraph_properties.append(spacing)

    before_key = f"{{{WORD_NS}}}before"
    current = spacing.get(before_key)
    if current is None or int(current) < int(value):
        spacing.set(before_key, value)


def is_data_table(element: Any, namespace: dict[str, str]) -> bool:
    return element.tag == f"{{{WORD_NS}}}tbl" and not element.xpath(
        ".//m:oMath",
        namespaces=namespace,
    )


def find_next_visible_paragraph(elements: list[Any], table_index: int) -> Any | None:
    for following in elements[table_index + 1 :]:
        if following.tag == f"{{{WORD_NS}}}tbl":
            return None
        if following.tag == f"{{{WORD_NS}}}p" and paragraph_has_visible_content(following):
            return following
    return None


def should_space_after_table(paragraph: Any) -> bool:
    style = paragraph_style(paragraph)
    return not style.startswith("Heading") and style not in {
        "TableCaption",
        "FigureCaption",
    }


def add_spacing_after_data_tables(document_root: Any) -> int:
    namespace = {"m": MATH_NS, "w": WORD_NS}
    body = document_root.find(f"{WORD}body")
    if body is None:
        return 0

    elements = report_body_elements(list(body))
    changed = 0
    for index, element in enumerate(elements):
        if not is_data_table(element, namespace):
            continue

        following = find_next_visible_paragraph(elements, index)
        if following is not None and should_space_after_table(following):
            set_paragraph_space_before(following, SPACING_AFTER_TABLE_TWIPS)
            changed += 1

    return changed


def table_grid_width(table: Any) -> int | None:
    widths = [
        int(float(value))
        for value in table.xpath("./w:tblGrid/w:gridCol/@w:w", namespaces={"w": WORD_NS})
    ]
    return sum(widths) if widths else None


def get_or_add_child(parent: Any, tag_name: str, index: int = 0) -> Any:
    child = parent.find(f"{WORD}{tag_name}")
    if child is not None:
        return child

    child = etree.Element(f"{WORD}{tag_name}")
    parent.insert(index, child)
    return child


def is_referat_keywords_text(text: str) -> bool:
    stripped = text.strip()
    if "," not in stripped or stripped != stripped.upper():
        return False

    keywords = [part.strip() for part in stripped.rstrip(".").split(",") if part.strip()]
    return 5 <= len(keywords) <= 15


def ensure_child(
    parent: Any, tag_name: str, before_tag_name: str | None = None
) -> tuple[Any, bool]:
    child = parent.find(f"{WORD}{tag_name}")
    if child is not None:
        return child, False

    child = etree.Element(f"{WORD}{tag_name}")
    if before_tag_name is None:
        parent.append(child)
        return child, True

    before = parent.find(f"{WORD}{before_tag_name}")
    if before is None:
        parent.append(child)
    else:
        parent.insert(list(parent).index(before), child)
    return child, True


def set_attribute(element: Any, name: str, value: str) -> bool:
    key = f"{WORD}{name}"
    if element.get(key) == value:
        return False
    element.set(key, value)
    return True


def remove_child(parent: Any, tag_name: str) -> bool:
    removed = False
    for child in parent.findall(f"{WORD}{tag_name}"):
        parent.remove(child)
        removed = True
    return removed


def normalize_referat_keyword_paragraph(paragraph: Any) -> bool:
    if not is_referat_keywords_text(element_text(paragraph)):
        return False

    changed = False
    paragraph_properties = get_or_add_child(paragraph, "pPr", 0)
    _, added = ensure_child(paragraph_properties, "suppressAutoHyphens", "spacing")
    changed = changed or added

    spacing = get_or_add_child(paragraph_properties, "spacing")
    changed = set_attribute(spacing, "before", "360") or changed
    changed = set_attribute(spacing, "after", "240") or changed
    changed = set_attribute(spacing, "line", "360") or changed
    changed = set_attribute(spacing, "lineRule", "auto") or changed

    indent = get_or_add_child(paragraph_properties, "ind")
    changed = set_attribute(indent, "left", "0") or changed
    changed = set_attribute(indent, "right", "0") or changed
    changed = set_attribute(indent, "firstLine", "709") or changed

    justification = get_or_add_child(paragraph_properties, "jc")
    changed = set_attribute(justification, "val", "both") or changed

    for run in paragraph.findall(f"{WORD}r"):
        run_properties = get_or_add_child(run, "rPr", 0)
        changed = remove_child(run_properties, "smallCaps") or changed
        _, added = ensure_child(run_properties, "caps")
        changed = changed or added

    return changed


def normalize_referat_keyword_paragraphs(document_root: Any) -> int:
    changed = 0
    for paragraph in document_root.xpath(".//w:p", namespaces={"w": WORD_NS}):
        if normalize_referat_keyword_paragraph(paragraph):
            changed += 1
    return changed


def set_front_matter_table_margins(tbl_pr: Any) -> None:
    for existing in tbl_pr.findall(f"{WORD}tblCellMar"):
        tbl_pr.remove(existing)

    cell_margins = etree.Element(f"{WORD}tblCellMar")
    for side in ("left", "right"):
        margin = etree.SubElement(cell_margins, f"{WORD}{side}")
        margin.set(f"{WORD}w", "108")
        margin.set(f"{WORD}type", "dxa")

    tbl_layout = tbl_pr.find(f"{WORD}tblLayout")
    insert_index = list(tbl_pr).index(tbl_layout) + 1 if tbl_layout is not None else len(tbl_pr)
    tbl_pr.insert(insert_index, cell_margins)


def normalize_front_matter_table_paragraph_indents(table: Any) -> bool:
    changed = False
    for paragraph in table.findall(f".//{WORD}p"):
        paragraph_properties = get_or_add_child(paragraph, "pPr", 0)
        paragraph_indent = paragraph_properties.find(f"{WORD}ind")
        if paragraph_indent is None:
            paragraph_indent = etree.Element(f"{WORD}ind")
            spacing = paragraph_properties.find(f"{WORD}spacing")
            insert_index = (
                list(paragraph_properties).index(spacing) + 1
                if spacing is not None
                else len(paragraph_properties)
            )
            paragraph_properties.insert(insert_index, paragraph_indent)
            changed = True
        if paragraph_indent.get(f"{WORD}left") != "0":
            paragraph_indent.set(f"{WORD}left", "0")
            changed = True
        if paragraph_indent.get(f"{WORD}firstLine") != "0":
            paragraph_indent.set(f"{WORD}firstLine", "0")
            changed = True
        for inherited_indent in ("hanging", "right"):
            if paragraph_indent.get(f"{WORD}{inherited_indent}") is not None:
                del paragraph_indent.attrib[f"{WORD}{inherited_indent}"]
                changed = True
    return changed


def normalize_front_matter_assignment_table(table: Any) -> bool:
    if "Планируемые результаты" not in element_text(table):
        return False

    changed = False
    if normalize_front_matter_table_paragraph_indents(table):
        changed = True
    tbl_pr = table.find(f"{WORD}tblPr")
    if tbl_pr is not None:
        for cell_margins in tbl_pr.findall(f"{WORD}tblCellMar"):
            tbl_pr.remove(cell_margins)
            changed = True

    first_row_properties = table.find(f"{WORD}tr/{WORD}trPr")
    if first_row_properties is not None:
        for table_header in first_row_properties.findall(f"{WORD}tblHeader"):
            first_row_properties.remove(table_header)
            changed = True

    return changed


def normalize_front_matter_signature_table(table: Any) -> bool:
    if "Задание принял к исполнению" not in element_text(table):
        return False

    changed = False
    if normalize_front_matter_table_paragraph_indents(table):
        changed = True
    tbl_pr = table.find(f"{WORD}tblPr")
    if tbl_pr is not None:
        table_justification = tbl_pr.find(f"{WORD}jc")
        if table_justification is None:
            table_justification = etree.Element(f"{WORD}jc")
            table_width = tbl_pr.find(f"{WORD}tblW")
            insert_index = list(tbl_pr).index(table_width) + 1 if table_width is not None else 0
            tbl_pr.insert(insert_index, table_justification)
            changed = True
        if table_justification.get(f"{WORD}val") != "left":
            table_justification.set(f"{WORD}val", "left")
            changed = True
        for cell_margins in tbl_pr.findall(f"{WORD}tblCellMar"):
            tbl_pr.remove(cell_margins)
            changed = True

    for row in table.findall(f"{WORD}tr"):
        for cell, width in zip(row.findall(f"{WORD}tc"), SIGNATURE_COLUMN_WIDTHS, strict=False):
            cell_properties = get_or_add_child(cell, "tcPr", 0)
            cell_width = cell_properties.find(f"{WORD}tcW")
            if cell_width is None:
                cell_width = etree.Element(f"{WORD}tcW")
                cell_properties.insert(0, cell_width)
                changed = True
            if cell_width.get(f"{WORD}w") != width:
                cell_width.set(f"{WORD}w", width)
                changed = True
            if cell_width.get(f"{WORD}type") != "dxa":
                cell_width.set(f"{WORD}type", "dxa")
                changed = True

    for row_properties in table.findall(f"{WORD}tr/{WORD}trPr"):
        row_height = row_properties.find(f"{WORD}trHeight")
        if row_height is None:
            row_height = etree.Element(f"{WORD}trHeight")
            row_properties.insert(0, row_height)
            changed = True
        if row_height.get(f"{WORD}val") != "980":
            row_height.set(f"{WORD}val", "980")
            changed = True
        if row_height.get(f"{WORD}hRule") != "atLeast":
            row_height.set(f"{WORD}hRule", "atLeast")
            changed = True

    return changed


def has_front_matter_assignment_table(document_root: Any) -> bool:
    return any(
        "Планируемые результаты" in element_text(table)
        for table in document_root.xpath(".//w:tbl", namespaces={"w": WORD_NS})
    )


def normalize_front_matter_settings(docx_path: str | Path) -> int:
    settings_xml = read_docx_part(docx_path, "word/settings.xml").decode("utf-8")
    updated_xml = settings_xml

    updated_xml = re.sub(
        r"<w:defaultTabStop\b[^>]*/>",
        '<w:defaultTabStop w:val="708"/>',
        updated_xml,
        count=1,
    )
    if "<w:autoHyphenation" not in updated_xml:
        updated_xml = re.sub(
            r"(<w:defaultTabStop\b[^>]*/>)",
            r"\1<w:autoHyphenation/>",
            updated_xml,
            count=1,
        )
    bottom_hyphenation_pattern = (
        r'<w:compatSetting\b(?=[^>]*\bw:name="useWord2013TrackBottomHyphenation")[^>]*/>'
    )
    bottom_hyphenation_setting = (
        '<w:compatSetting w:name="useWord2013TrackBottomHyphenation" '
        'w:uri="http://schemas.microsoft.com/office/word" w:val="0"/>'
    )
    if re.search(bottom_hyphenation_pattern, updated_xml):
        updated_xml = re.sub(
            bottom_hyphenation_pattern,
            bottom_hyphenation_setting,
            updated_xml,
            count=1,
        )
    elif "</w:compat>" in updated_xml:
        updated_xml = updated_xml.replace(
            "</w:compat>",
            f"{bottom_hyphenation_setting}</w:compat>",
            1,
        )

    if updated_xml == settings_xml:
        return 0

    rewrite_docx_part(docx_path, "word/settings.xml", updated_xml.encode("utf-8"))
    return 1


def normalize_front_matter_table_geometry(docx_path: str | Path) -> int:
    document_xml = read_docx_part(docx_path, "word/document.xml")
    parser = etree.XMLParser(resolve_entities=False, remove_blank_text=False)
    document_root = etree.fromstring(document_xml, parser=parser)
    has_assignment_table = has_front_matter_assignment_table(document_root)

    changed = 0
    for table in document_root.xpath(".//w:tbl", namespaces={"w": WORD_NS}):
        if normalize_front_matter_assignment_table(table):
            changed += 1
        if normalize_front_matter_signature_table(table):
            changed += 1

    settings_changes = normalize_front_matter_settings(docx_path) if has_assignment_table else 0
    if changed == 0:
        return settings_changes

    updated_xml = etree.tostring(
        document_root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    rewrite_docx_part(docx_path, "word/document.xml", updated_xml)
    return changed + settings_changes


def normalize_docx_xml_layout(docx_path: str | Path) -> int:
    document_xml = read_docx_part(docx_path, "word/document.xml")
    parser = etree.XMLParser(resolve_entities=False, remove_blank_text=False)
    document_root = etree.fromstring(document_xml, parser=parser)
    table_spacing_changes = add_spacing_after_data_tables(document_root)
    referat_keyword_changes = normalize_referat_keyword_paragraphs(document_root)
    changes = table_spacing_changes + referat_keyword_changes

    if changes == 0:
        return 0

    updated_xml = etree.tostring(
        document_root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    rewrite_docx_part(docx_path, "word/document.xml", updated_xml)
    return changes


def get_counts_from_docx(docx_path: str | Path) -> DocumentCounts:
    """Count captions and used-source references from a generated DOCX."""
    figures = 0
    tables = 0
    sources = 0

    with tempfile.TemporaryDirectory() as temp_dir:
        with zipfile.ZipFile(docx_path, "r") as archive:
            archive.extractall(temp_dir)

        document_path = Path(temp_dir) / "word" / "document.xml"
        if not document_path.exists():
            return DocumentCounts(figures=0, tables=0, sources=0)

        tree = etree.parse(str(document_path))
        root = tree.getroot()
        namespace = {"w": WORD_NS}

        for paragraph in root.xpath(".//w:p", namespaces=namespace):
            style_values = paragraph.xpath(".//w:pStyle/@w:val", namespaces=namespace)
            if not style_values:
                continue
            style = style_values[0]
            if style == "FigureCaption":
                figures += 1
            elif style == "TableCaption":
                tables += 1

        # The bibliography builder emits only cited sources and numbers them densely
        # by first use, so the used-source count is the highest citation number.
        max_source = 0
        for text in root.xpath(".//w:t/text()", namespaces=namespace):
            matches = re.findall(r"\[([\d,\s]+)\]", text)
            for match in matches:
                numbers = [
                    int(value.strip()) for value in match.split(",") if value.strip().isdigit()
                ]
                if numbers:
                    max_source = max(max_source, max(numbers))

        sources = max_source

    return DocumentCounts(figures=figures, tables=tables, sources=sources)
