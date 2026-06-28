import re
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, SPACING_AFTER_TABLE_TWIPS, WORD_NS
from .docx_package import read_docx_part, rewrite_docx_part
from .models import DocumentCounts


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
    body = document_root.find(f"{{{WORD_NS}}}body")
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


def normalize_docx_xml_layout(docx_path: str | Path) -> int:
    document_xml = read_docx_part(docx_path, "word/document.xml")
    parser = etree.XMLParser(resolve_entities=False, remove_blank_text=False)
    document_root = etree.fromstring(document_xml, parser=parser)
    table_spacing_changes = add_spacing_after_data_tables(document_root)

    if table_spacing_changes == 0:
        return 0

    updated_xml = etree.tostring(
        document_root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    rewrite_docx_part(docx_path, "word/document.xml", updated_xml)
    return table_spacing_changes


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
