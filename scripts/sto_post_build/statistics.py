"""Count report statistics from generated and Word-accepted DOCX packages."""

import re
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

from .constants import WORD_NS
from .models import DocumentCounts


def get_counts_from_docx(docx_path: str | Path) -> DocumentCounts:
    """Count captions and used-source references from a generated DOCX."""
    figures = 0
    tables = 0
    sources = 0
    appendices = 0

    with tempfile.TemporaryDirectory() as temp_dir:
        with zipfile.ZipFile(docx_path, "r") as archive:
            archive.extractall(temp_dir)

        document_path = Path(temp_dir) / "word" / "document.xml"
        if not document_path.exists():
            return DocumentCounts(figures=0, tables=0, sources=0)

        tree = etree.parse(str(document_path))
        root = tree.getroot()
        namespace = {"w": WORD_NS}
        style_names: dict[str, str] = {}
        styles_path = Path(temp_dir) / "word" / "styles.xml"
        if styles_path.exists():
            styles_root = etree.parse(str(styles_path)).getroot()
            for style_node in styles_root.xpath("./w:style", namespaces=namespace):
                style_id = style_node.get(f"{{{WORD_NS}}}styleId")
                name = style_node.find(f"{{{WORD_NS}}}name")
                if style_id and name is not None:
                    style_names[style_id] = name.get(f"{{{WORD_NS}}}val", "")

        for paragraph in root.xpath(".//w:p", namespaces=namespace):
            style_values = paragraph.xpath("./w:pPr/w:pStyle/@w:val", namespaces=namespace)
            if not style_values:
                continue
            style = style_values[0]
            style_name = style_names.get(style, "")
            if style == "FigureCaption" or style_name == "+№ - Название рисунка":
                figures += 1
            elif style == "TableCaption" or style_name == "+№ - Название таблицы":
                tables += 1
            elif style == "AppendixHeading":
                appendices += 1
            elif style == "StructuralHeading":
                text = "".join(paragraph.xpath(".//w:t/text()", namespaces=namespace))
                if re.fullmatch(r"\s*ПРИЛОЖЕНИЕ\s+[\u0410-\u042f\u0401]\s*", text, re.IGNORECASE):
                    appendices += 1

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

    return DocumentCounts(figures=figures, tables=tables, sources=sources, appendices=appendices)
