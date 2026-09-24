"""Build equal-content generator and DOTM-style Word comparison documents."""

import argparse
import copy
import json
import subprocess
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tests/fixtures/dotm-word-corpus"
DOTM = ROOT / "tests/fixtures/validator/etalon/SHablon_oformlenija_VKR_2022_5_6.dotm"
OUTPUT = ROOT / ".agent-work/dotm-word-corpus"
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{WORD_NS}}}"
NS = {"w": WORD_NS}
STYLE_MAP = {
    "Normal": "1-",
    "TitlePageText": "ac",
    "StructuralHeading": "afc",
    "StructuralHeadingNoTOC": "aff0",
    "FigureCaption": "-",
    "TableCaption": "-1",
    "TableText": "aff1",
    "StoHeading1": "1",
    "StoHeading2": "2",
    "StoHeading3": "3",
    "StoHeading4": "4",
    "StoHeading5": "5",
    "StoHeading6": "6",
    "TOC1": "13",
    "TOC2": "23",
    "TOC3": "33",
    "TOC4": "43",
}
TOC_LABELS = tuple(f"Контроль оглавления уровень {level}" for level in range(1, 5))


def read_parts(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def write_parts(path: Path, parts: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


def paragraph_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath(".//w:t/text()", namespaces=NS))


def paragraph_style(paragraph: etree._Element) -> str:
    values = paragraph.xpath("./w:pPr/w:pStyle/@w:val", namespaces=NS)
    return str(values[0]) if values else "Normal"


def set_paragraph_style(paragraph: etree._Element, style_id: str) -> None:
    properties = paragraph.find(f"{W}pPr")
    if properties is None:
        properties = etree.Element(f"{W}pPr")
        paragraph.insert(0, properties)
    style = properties.find(f"{W}pStyle")
    if style is None:
        style = etree.Element(f"{W}pStyle")
        properties.insert(0, style)
    style.set(f"{W}val", style_id)


def set_toc_tab(paragraph: etree._Element, label: str, level: int) -> None:
    for run in list(paragraph.findall(f"{W}r")):
        paragraph.remove(run)
    run = etree.SubElement(paragraph, f"{W}r")
    etree.SubElement(run, f"{W}t").text = label
    etree.SubElement(run, f"{W}tab")
    etree.SubElement(run, f"{W}t").text = str(level)


def patch_document(data: bytes, dotm_styles: bool) -> bytes:
    root = etree.fromstring(data)
    for paragraph in root.xpath(".//w:body//w:p", namespaces=NS):
        text = paragraph_text(paragraph)
        toc_level = next(
            (level for level, label in enumerate(TOC_LABELS, 1) if text.startswith(label)),
            None,
        )
        if toc_level is not None:
            set_toc_tab(paragraph, TOC_LABELS[toc_level - 1], toc_level)
            set_paragraph_style(paragraph, f"TOC{toc_level}")
        if dotm_styles:
            style_id = paragraph_style(paragraph)
            if text.startswith("ШАБЛОН, СТИЛЬ, ОТСТУП"):
                style_id = "aff4"
            elif text.startswith("Петров, П.П. Автоматизация документооборота"):
                style_id = "a0"
            else:
                style_id = STYLE_MAP.get(style_id, style_id)
            set_paragraph_style(paragraph, style_id)
            properties = paragraph.find(f"{W}pPr")
            if properties is not None:
                for tag in ("spacing", "ind", "jc", "tabs", "numPr"):
                    for child in properties.findall(f"{W}{tag}"):
                        properties.remove(child)
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True)


def merged_dotm_styles(generated: bytes, dotm: bytes) -> bytes:
    generated_root = etree.fromstring(generated)
    dotm_root = etree.fromstring(dotm)
    generated_defaults = generated_root.find(f"{W}docDefaults")
    dotm_defaults = dotm_root.find(f"{W}docDefaults")
    if generated_defaults is not None and dotm_defaults is not None:
        generated_root.replace(generated_defaults, copy.deepcopy(dotm_defaults))
    existing = set(generated_root.xpath("./w:style/@w:styleId", namespaces=NS))
    for style in dotm_root.findall(f"{W}style"):
        if style.get(f"{W}styleId") in existing:
            raise ValueError(f"Duplicate style id: {style.get(f'{W}styleId')}")
        generated_root.append(copy.deepcopy(style))
    return etree.tostring(generated_root, encoding="UTF-8", xml_declaration=True)


def visible_texts(parts: dict[str, bytes]) -> list[str]:
    root = etree.fromstring(parts["word/document.xml"])
    return [paragraph_text(p) for p in root.xpath(".//w:body//w:p", namespaces=NS)]


def used_styles(parts: dict[str, bytes]) -> set[str]:
    root = etree.fromstring(parts["word/document.xml"])
    return {
        paragraph_style(paragraph)
        for paragraph in root.xpath(".//w:body//w:p", namespaces=NS)
        if paragraph_text(paragraph).strip()
    }


def build() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    raw_path = OUTPUT / "generator-raw.docx"
    subprocess.run(
        ["npx", "tsx", "src/index.ts", "build", str(SOURCE), str(raw_path)],
        cwd=ROOT,
        check=True,
    )
    original = read_parts(raw_path)
    dotm_parts = read_parts(DOTM)
    generator = dict(original)
    generator["word/document.xml"] = patch_document(original["word/document.xml"], False)
    reference = dict(original)
    reference["word/document.xml"] = patch_document(original["word/document.xml"], True)
    reference["word/styles.xml"] = merged_dotm_styles(
        original["word/styles.xml"], dotm_parts["word/styles.xml"]
    )
    reference["word/numbering.xml"] = dotm_parts["word/numbering.xml"]
    if visible_texts(generator) != visible_texts(reference):
        raise ValueError("Generator and DOTM-style reference have different visible text.")
    missing_generator = STYLE_MAP.keys() - used_styles(generator)
    missing_reference = (set(STYLE_MAP.values()) | {"aff4", "a0"}) - used_styles(reference)
    if missing_generator or missing_reference:
        raise ValueError(
            f"Unused styles: generator={sorted(missing_generator)}, "
            f"DOTM reference={sorted(missing_reference)}"
        )
    write_parts(OUTPUT / "generator.docx", generator)
    write_parts(OUTPUT / "dotm-reference.docx", reference)
    print(json.dumps({"paragraphs": len(visible_texts(generator)), "equalContent": True}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["build"])
    arguments = parser.parse_args()
    if arguments.command == "build":
        build()


if __name__ == "__main__":
    main()
