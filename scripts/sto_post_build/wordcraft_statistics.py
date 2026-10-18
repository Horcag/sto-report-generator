"""Prepare a disposable DOCX for Wordcraft without loading Word COM."""

import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree

from .constants import WORD_NS
from .docx_package import STATISTIC_PLACEHOLDERS
from .orchestrator import create_replacements
from .statistics import get_counts_from_docx
from .word_automation import page_replacements


def replace_paragraph_tokens(paragraph: etree._Element, replacements: dict[str, str]) -> bool:
    """Replace split Word runs while retaining each run's formatting and surrounding text."""
    nodes = list(paragraph.iter(f"{{{WORD_NS}}}t"))
    text = "".join(node.text or "" for node in nodes)
    matches = list(re.finditer("|".join(re.escape(key) for key in replacements), text))
    for match in reversed(matches):
        offset = 0
        for node in nodes:
            value = node.text or ""
            end = offset + len(value)
            if offset < match.end() and end > match.start():
                prefix = value[: max(0, match.start() - offset)]
                suffix = value[max(0, match.end() - offset) :]
                replacement = replacements[match.group()] if offset <= match.start() else ""
                node.text = prefix + replacement + suffix
                node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            offset = end
    return bool(matches)


def prepare_docx(source: Path, destination: Path, pages: int) -> list[str]:
    if source.resolve() == destination.resolve():
        raise ValueError("Wordcraft preparation must write a separate DOCX copy.")
    if pages < 1:
        raise ValueError("Page count must be a positive integer.")
    counts = get_counts_from_docx(source)
    replacements = create_replacements(
        counts.figures, counts.tables, counts.sources, counts.appendices
    )
    replacements.update(page_replacements(pages))
    warnings: list[str] = []
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(destination, "w") as output:
        for entry in archive.infolist():
            data = archive.read(entry)
            if (
                entry.filename.startswith("word/media/")
                and entry.filename.lower().endswith(".png")
                and not data.startswith(b"\x89PNG\r\n\x1a\n")
            ):
                raise ValueError(
                    "DOCX contains invalid PNG image data. Rebuild SVG fallbacks with the current generator."
                )
            if entry.filename.startswith("word/") and entry.filename.endswith(".xml"):
                parser = etree.XMLParser(resolve_entities=False, no_network=True)
                root = etree.fromstring(data, parser)
                paragraphs = list(root.iter(f"{{{WORD_NS}}}p"))
                changed = False
                for paragraph in paragraphs:
                    replaced = replace_paragraph_tokens(paragraph, replacements)
                    if replaced:
                        # Same empty-count punctuation cleanup as Word, preserving run styles.
                        replace_paragraph_tokens(paragraph, {" ,": ""})
                        replace_paragraph_tokens(paragraph, {", ,": ","})
                    changed = replaced or changed
                for paragraph in paragraphs:
                    text = "".join(node.text or "" for node in paragraph.iter(f"{{{WORD_NS}}}t"))
                    if any(token in text for token in STATISTIC_PLACEHOLDERS):
                        raise ValueError(
                            "Statistic placeholders remain in prepared Wordcraft DOCX."
                        )
                if changed:
                    data = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
            if entry.filename.lower().endswith(".svg"):
                warnings.append(
                    "DOCX contains SVG media; check raster fallback text and sharpness in the Wordcraft PDF."
                )
            output.writestr(entry, data)
    return sorted(set(warnings))


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: wordcraft_statistics <source.docx> <copy.docx> <pages>", file=sys.stderr)
        return 2
    warnings = prepare_docx(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]))
    print(json.dumps({"warnings": warnings}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
