"""Native full post-build entrypoint under the owned Word acceptance launcher."""

import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

from lxml import etree

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.sto_post_build.constants import WORD_NS
from scripts.sto_post_build.docx_package import read_docx_part, rewrite_docx_part
from scripts.sto_post_build.orchestrator import create_replacements, post_build
from scripts.sto_post_build.pdf_export import PdfImageQualityError
from scripts.sto_post_build.process_ownership import record_process
from scripts.sto_post_build.statistics import get_counts_from_docx
from scripts.sto_post_build.word_automation import normalize_replacement_text, page_replacements
from scripts.sto_post_build.wordcraft_statistics import replace_paragraph_tokens


def page_templates(docx: str) -> list[str]:
    root = etree.fromstring(read_docx_part(docx, "word/document.xml"))
    texts = [
        "".join(node.text or "" for node in p.iter(f"{{{WORD_NS}}}t"))
        for p in root.iter(f"{{{WORD_NS}}}p")
    ]
    return [text for text in texts if "{{PAGES}}" in text or "{{PAGES_WORD}}" in text]


def restore_page_templates(docx: str, templates: list[str], replacements: dict[str, str]) -> None:
    """Let final acceptance recompute referat pages after its table pagination."""
    root = etree.fromstring(read_docx_part(docx, "word/document.xml"))
    for template in templates:
        rendered = template
        for token, value in replacements.items():
            rendered = rendered.replace(token, value)
        rendered = normalize_replacement_text(rendered)
        matches = [
            p
            for p in root.iter(f"{{{WORD_NS}}}p")
            if "".join(n.text or "" for n in p.iter(f"{{{WORD_NS}}}t")) == rendered
        ]
        if len(matches) != 1:
            raise RuntimeError(
                "Cannot uniquely restore the referat page template for final acceptance."
            )
        replace_paragraph_tokens(matches[0], {rendered: template})
    rewrite_docx_part(
        docx, "word/document.xml", etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    )


def main() -> None:
    record_process(os.getpid(), "post-build-python")
    templates = page_templates(sys.argv[1])
    counts = get_counts_from_docx(sys.argv[1])
    result = post_build(sys.argv[1], sys.argv[2], sys.argv[3])
    replacements = create_replacements(
        counts.figures, counts.tables, counts.sources, counts.appendices
    )
    replacements.update(page_replacements(result.pages))
    restore_page_templates(sys.argv[1], templates, replacements)
    evidence = {
        **asdict(result),
        "pdf_image_quality": os.environ.get("STO_WORD_PDF_IMAGE_QUALITY", "original"),
    }
    Path(sys.argv[4]).write_text(json.dumps(evidence), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        kind = (
            "pdf-image-quality"
            if isinstance(error, PdfImageQualityError)
            else (
                "preparation"
                if str(error).startswith(
                    ("Formula replacement aborted:", "Cannot uniquely restore")
                )
                else None
            )
        )
        if kind is None:
            raise
        Path(sys.argv[4]).write_text(
            json.dumps({"status": "failed", "failureKind": kind, "message": str(error)}),
            encoding="utf-8",
        )
        print(f"Word renderer deterministic failure [{kind}]: {error}", file=sys.stderr)
        sys.exit(1)
