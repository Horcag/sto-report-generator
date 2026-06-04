import contextlib
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .constants import (
    BROKEN_REFERENCE_MARKERS,
    MAX_IMAGE_WIDTH_POINTS,
    WD_ACTIVE_END_PAGE_NUMBER,
    WD_ALIGN_PARAGRAPH_CENTER,
    WD_EXPORT_FORMAT_PDF,
    WD_FIND_CONTINUE,
    WD_REPLACE_ALL,
    WD_STATISTIC_PAGES,
)
from .models import WordPostBuildResult


def normalize_tables(doc: Any) -> int:
    changed = 0
    for index in range(1, doc.Tables.Count + 1):
        try:
            doc.Tables(index).Rows(1).HeadingFormat = True
            changed += 1
        except Exception:
            continue
    return changed


def normalize_inline_images(doc: Any) -> tuple[int, int]:
    centered = 0
    scaled = 0

    for index in range(1, doc.InlineShapes.Count + 1):
        try:
            shape = doc.InlineShapes(index)
            shape.Range.ParagraphFormat.Alignment = WD_ALIGN_PARAGRAPH_CENTER
            centered += 1

            shape.LockAspectRatio = True
            if abs(shape.Width - MAX_IMAGE_WIDTH_POINTS) > 1:
                shape.Width = MAX_IMAGE_WIDTH_POINTS
                scaled += 1
        except Exception:
            continue

    return centered, scaled


def previous_paragraph_before(doc: Any, position: int) -> Any | None:
    previous = None
    for paragraph in doc.Paragraphs:
        try:
            if paragraph.Range.End <= position:
                previous = paragraph
                continue
        except Exception:
            continue
        break
    return previous


def keep_small_tables_on_one_page(doc: Any) -> int:
    moved = 0

    doc.Repaginate()
    for index in range(1, doc.Tables.Count + 1):
        try:
            table = doc.Tables(index)
            if table.Rows.Count > 10:
                continue

            start_page = doc.Range(
                table.Range.Start,
                table.Range.Start,
            ).Information(WD_ACTIVE_END_PAGE_NUMBER)
            end_position = max(table.Range.Start, table.Range.End - 1)
            end_page = doc.Range(end_position, end_position).Information(WD_ACTIVE_END_PAGE_NUMBER)
            if start_page == end_page:
                continue

            caption = previous_paragraph_before(doc, table.Range.Start)
            if caption is None:
                continue

            caption_text = caption.Range.Text.strip()
            if not caption_text.startswith("Таблица"):
                continue

            caption.Range.ParagraphFormat.PageBreakBefore = True
            moved += 1
        except Exception:
            continue

    if moved:
        doc.Repaginate()

    return moved


def get_default_pdf_path(docx_path: str | Path) -> str:
    return str(Path(docx_path).with_suffix(".pdf"))


def export_pdf(doc: Any, docx_path: str | Path, pdf_output_path: str | Path | None = None) -> str:
    pdf_path = os.path.abspath(str(pdf_output_path or get_default_pdf_path(docx_path)))
    Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)

    if os.path.exists(pdf_path):
        try:
            os.remove(pdf_path)
        except PermissionError as error:
            raise RuntimeError(
                f"PDF export target is locked. Close the PDF and rerun post-build: {pdf_path}"
            ) from error

    doc.ExportAsFixedFormat(pdf_path, WD_EXPORT_FORMAT_PDF)
    return pdf_path


def find_broken_references(doc: Any) -> list[str]:
    errors: list[str] = []
    for paragraph in doc.Paragraphs:
        text = paragraph.Range.Text
        if any(marker in text for marker in BROKEN_REFERENCE_MARKERS):
            errors.append(f"CRITICAL: Broken reference or source found: {text.strip()}")
    return errors


def replace_placeholders(doc: Any, replacements: Mapping[str, str]) -> None:
    for placeholder, value in replacements.items():
        range_object = doc.Content
        range_object.Find.ClearFormatting()
        range_object.Find.Replacement.ClearFormatting()
        range_object.Find.Execute(
            placeholder,
            False,
            False,
            False,
            False,
            False,
            True,
            WD_FIND_CONTINUE,
            False,
            value,
            WD_REPLACE_ALL,
        )

    range_object = doc.Content
    range_object.Find.ClearFormatting()
    range_object.Find.Replacement.ClearFormatting()
    range_object.Find.Execute(
        " ,",
        False,
        False,
        False,
        False,
        False,
        True,
        WD_FIND_CONTINUE,
        False,
        "",
        WD_REPLACE_ALL,
    )
    range_object = doc.Content
    range_object.Find.Execute(
        ", ,",
        False,
        False,
        False,
        False,
        False,
        True,
        WD_FIND_CONTINUE,
        False,
        ",",
        WD_REPLACE_ALL,
    )


def create_word_application() -> Any:
    import win32com.client

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    return word


def run_word_post_build(
    docx_path: str | Path,
    replacements: Mapping[str, str],
    pdf_output_path: str | Path | None = None,
) -> WordPostBuildResult:
    word = None
    doc = None
    try:
        word = create_word_application()
        doc = word.Documents.Open(os.path.abspath(str(docx_path)), ReadOnly=False)

        if doc.TablesOfContents.Count > 0:
            doc.TablesOfContents(1).Update()

        normalized_tables = normalize_tables(doc)
        centered_images, scaled_images = normalize_inline_images(doc)
        moved_small_tables = keep_small_tables_on_one_page(doc)

        doc.Repaginate()
        pages = doc.ComputeStatistics(WD_STATISTIC_PAGES)

        broken_references = find_broken_references(doc)
        if broken_references:
            raise RuntimeError("\n".join(broken_references))

        page_replacements = {**replacements, "{{PAGES}}": str(pages)}
        replace_placeholders(doc, page_replacements)
        doc.Save()
        pdf_path = export_pdf(doc, docx_path, pdf_output_path)

        return WordPostBuildResult(
            pages=pages,
            normalized_tables=normalized_tables,
            centered_images=centered_images,
            scaled_images=scaled_images,
            moved_small_tables=moved_small_tables,
            pdf_path=pdf_path,
        )
    finally:
        if doc is not None:
            with contextlib.suppress(Exception):
                doc.Close(False)
        if word is not None:
            with contextlib.suppress(Exception):
                word.Quit()
