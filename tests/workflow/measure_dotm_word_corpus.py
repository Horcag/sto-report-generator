"""Measure paragraph geometry in accepted equal-content Word documents."""

import argparse
import hashlib
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from lxml import etree

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{WORD_NS}}}"
NS = {"w": WORD_NS}
GEOMETRY_TAGS = ("spacing", "ind", "jc", "tabs")


def read_part(path: Path, name: str) -> bytes:
    with zipfile.ZipFile(path) as archive:
        return archive.read(name)


def attributes(element: etree._Element) -> dict[str, str]:
    return {etree.QName(key).localname: value for key, value in element.attrib.items()}


def geometry(properties: etree._Element | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if properties is None:
        return result
    for tag in GEOMETRY_TAGS:
        element = properties.find(f"{W}{tag}")
        if element is None:
            continue
        if tag == "tabs":
            result[tag] = [attributes(tab) for tab in element.findall(f"{W}tab")]
        else:
            result[tag] = attributes(element)
    return result


def merge_geometry(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = {
        key: value.copy() if isinstance(value, dict) else value for key, value in base.items()
    }
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key].update(value)
        else:
            merged[key] = value
    return merged


def measure_docx(path: Path) -> dict[str, Any]:
    document = etree.fromstring(read_part(path, "word/document.xml"))
    styles_root = etree.fromstring(read_part(path, "word/styles.xml"))
    styles = {style.get(f"{W}styleId"): style for style in styles_root.findall(f"{W}style")}
    defaults = geometry(styles_root.find(f"{W}docDefaults/{W}pPrDefault/{W}pPr"))
    style_cache: dict[str, dict[str, Any]] = {}

    def style_geometry(style_id: str, visited: frozenset[str] = frozenset()) -> dict[str, Any]:
        if style_id in style_cache:
            return style_cache[style_id]
        style = styles.get(style_id)
        if style is None or style_id in visited:
            return defaults
        based_on = style.find(f"{W}basedOn")
        base_id = based_on.get(f"{W}val") if based_on is not None else None
        base = style_geometry(base_id, visited | {style_id}) if base_id else defaults
        measured = merge_geometry(base, geometry(style.find(f"{W}pPr")))
        style_cache[style_id] = measured
        return measured

    used: dict[str, list[dict[str, Any]]] = defaultdict(list)
    body = document.find(f"{W}body")
    if body is None:
        raise ValueError(f"No document body in {path}")
    for index, paragraph in enumerate(body.iter(f"{W}p")):
        text = "".join(paragraph.xpath(".//w:t/text()", namespaces=NS)).strip()
        if not text:
            continue
        properties = paragraph.find(f"{W}pPr")
        pstyle = properties.find(f"{W}pStyle") if properties is not None else None
        style_id = pstyle.get(f"{W}val") if pstyle is not None else "(default)"
        style = styles.get(style_id)
        name_node = style.find(f"{W}name") if style is not None else None
        style_name = name_node.get(f"{W}val") if name_node is not None else style_id
        effective = merge_geometry(style_geometry(style_id), geometry(properties))
        used[style_name].append(
            {"styleId": style_id, "text": text[:100], "geometry": effective, "index": index}
        )
    summary: dict[str, Any] = {}
    for name, rows in sorted(used.items()):
        variants = {json.dumps(row["geometry"], ensure_ascii=False, sort_keys=True) for row in rows}
        summary[name] = {
            "count": len(rows),
            "styleIds": sorted({row["styleId"] for row in rows}),
            "sample": rows[0]["text"],
            "effectiveGeometryVariants": [json.loads(value) for value in sorted(variants)],
        }
    tables = body.xpath("./w:tbl", namespaces=NS)
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "usedStyles": summary,
        "tables": [len(table.xpath("./w:tr", namespaces=NS)) for table in tables],
    }


def pdf_pages(path: Path) -> int:
    return len(re.findall(rb"/Type\s*/Page\b", path.read_bytes()))


def visible_texts(path: Path) -> list[str]:
    document = etree.fromstring(read_part(path, "word/document.xml"))
    return [
        "".join(paragraph.xpath(".//w:t/text()", namespaces=NS))
        for paragraph in document.xpath(".//w:body//w:p", namespaces=NS)
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("generator_docx", type=Path)
    parser.add_argument("reference_docx", type=Path)
    parser.add_argument("generator_pdf", type=Path)
    parser.add_argument("reference_pdf", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    generator_text = visible_texts(args.generator_docx)
    reference_text = visible_texts(args.reference_docx)
    if generator_text != reference_text:
        differences = [
            index
            for index, (left, right) in enumerate(zip(generator_text, reference_text, strict=False))
            if left != right
        ]
        raise ValueError(
            "Accepted DOCX content differs: "
            f"{len(generator_text)} versus {len(reference_text)} paragraphs; "
            f"first different indices: {differences[:5]}"
        )
    result = {
        "acceptedParagraphs": len(generator_text),
        "acceptedContentEqual": True,
        "generator": measure_docx(args.generator_docx),
        "dotmReference": measure_docx(args.reference_docx),
        "pdfPages": {
            "generator": pdf_pages(args.generator_pdf),
            "dotmReference": pdf_pages(args.reference_pdf),
        },
    }
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
        print(f"Measured equal content in {len(generator_text)} paragraphs: {args.output}")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
