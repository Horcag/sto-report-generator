import contextlib
import os
import re
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
    report_start = report_start_position(doc)
    changed = 0
    for index in range(1, doc.Tables.Count + 1):
        try:
            table = doc.Tables(index)
            if table.Range.Start < report_start:
                continue
            table.Rows(1).HeadingFormat = True
            changed += 1
        except Exception:
            continue
    return changed


def report_start_position(doc: Any) -> int:
    for paragraph in doc.Paragraphs:
        try:
            if paragraph.Range.Text.strip().upper() == "РЕФЕРАТ":
                return paragraph.Range.Start
        except Exception:
            continue
    return 0


def pluralize_ru(number: int, form1: str, form2: str, form5: str) -> str:
    number = abs(number) % 100
    number_last_digit = number % 10
    if 10 < number < 20:
        return form5
    if 1 < number_last_digit < 5:
        return form2
    if number_last_digit == 1:
        return form1
    return form5


def page_replacements(pages: int) -> dict[str, str]:
    return {
        "{{PAGES}}": str(pages),
        "{{PAGES_WORD}}": pluralize_ru(pages, "страницу", "страницы", "страниц"),
    }


def normalize_replacement_text(text: str) -> str:
    return text.replace(" ,", "").replace(", ,", ",")


def collect_page_placeholder_paragraphs(doc: Any) -> list[tuple[Any, str]]:
    paragraphs = []
    for paragraph in doc.Paragraphs:
        text = paragraph.Range.Text.rstrip("\r\x07")
        if "{{PAGES}}" in text or "{{PAGES_WORD}}" in text:
            paragraphs.append((paragraph, text))
    return paragraphs


def render_page_placeholder_text(
    template: str,
    replacements: Mapping[str, str],
    pages: int,
) -> str:
    rendered = template
    for placeholder, value in {**replacements, **page_replacements(pages)}.items():
        rendered = rendered.replace(placeholder, value)
    return normalize_replacement_text(rendered)


def replace_paragraph_text(paragraph: Any, text: str) -> None:
    text_range = paragraph.Range
    text_range.End = max(text_range.Start, text_range.End - 1)
    text_range.Text = text


def replace_literal_text(doc: Any, old_text: str, new_text: str) -> None:
    if old_text == new_text:
        return

    range_object = doc.Content
    range_object.Find.ClearFormatting()
    range_object.Find.Replacement.ClearFormatting()
    range_object.Find.Execute(
        old_text,
        False,
        False,
        False,
        False,
        False,
        True,
        WD_FIND_CONTINUE,
        False,
        new_text,
        WD_REPLACE_ALL,
    )


def update_toc(doc: Any) -> None:
    if doc.TablesOfContents.Count > 0:
        doc.TablesOfContents(1).Update()


def stabilize_page_replacements(
    doc: Any,
    templates: list[tuple[Any, str]],
    replacements: Mapping[str, str],
    max_iterations: int = 5,
) -> int:
    doc.Repaginate()
    pages = doc.ComputeStatistics(WD_STATISTIC_PAGES)

    for _ in range(max_iterations):
        for paragraph, template in templates:
            replace_paragraph_text(
                paragraph,
                render_page_placeholder_text(template, replacements, pages),
            )

        update_toc(doc)
        doc.Repaginate()
        actual_pages = doc.ComputeStatistics(WD_STATISTIC_PAGES)
        if actual_pages == pages:
            return pages
        pages = actual_pages

    for paragraph, template in templates:
        replace_paragraph_text(
            paragraph,
            render_page_placeholder_text(template, replacements, pages),
        )
    update_toc(doc)
    doc.Repaginate()
    return doc.ComputeStatistics(WD_STATISTIC_PAGES)


def resync_saved_page_replacements(
    doc: Any,
    templates: list[tuple[Any, str]],
    replacements: Mapping[str, str],
    pages: int,
) -> int:
    if not templates:
        return pages

    doc.Repaginate()
    saved_pages = doc.ComputeStatistics(WD_STATISTIC_PAGES)
    if saved_pages == pages:
        return pages

    for _paragraph, template in templates:
        replace_literal_text(
            doc,
            render_page_placeholder_text(template, replacements, pages),
            render_page_placeholder_text(template, replacements, saved_pages),
        )
    update_toc(doc)
    doc.Repaginate()
    return saved_pages


def resync_pdf_page_replacements(
    doc: Any,
    docx_path: str | Path,
    pdf_path: str,
    pdf_output_path: str | Path | None,
    templates: list[tuple[Any, str]],
    replacements: Mapping[str, str],
    pages: int,
) -> tuple[int, str]:
    if not templates:
        return pages, pdf_path

    pdf_pages = count_pdf_pages(pdf_path)
    if pdf_pages == pages:
        return pages, pdf_path

    for _paragraph, template in templates:
        replace_literal_text(
            doc,
            render_page_placeholder_text(template, replacements, pages),
            render_page_placeholder_text(template, replacements, pdf_pages),
        )
    update_toc(doc)
    doc.Repaginate()
    doc.Save()
    return pdf_pages, export_pdf(doc, docx_path, pdf_output_path)


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


def count_pdf_pages(pdf_path: str | Path) -> int:
    data = Path(pdf_path).read_bytes()
    return len(re.findall(rb"/Type\s*/Page\b", data))


def replace_referat_page_count(doc: Any, pages: int) -> bool:
    page_word = pluralize_ru(pages, "страницу", "страницы", "страниц")
    pattern = re.compile(
        r"^(Отчет по практике содержит )\d+\s+\S+(\s+и\s+\d+\s+(?:источник|источника|источников)\.)$"
    )

    for paragraph in doc.Paragraphs:
        text = paragraph.Range.Text.rstrip("\r\x07")
        match = pattern.match(text)
        if not match:
            continue
        updated = f"{match.group(1)}{pages} {page_word}{match.group(2)}"
        if updated == text:
            return False
        replace_literal_text(doc, text, updated)
        return True
    return False


def resync_docx_page_count_from_pdf(
    docx_path: str | Path,
    pdf_path: str | Path,
    pdf_output_path: str | Path | None = None,
) -> tuple[int, str]:
    pages = count_pdf_pages(pdf_path)
    word = None
    doc = None
    try:
        word = create_word_application()
        doc = word.Documents.Open(os.path.abspath(str(docx_path)), ReadOnly=False)
        current_pdf_path = str(pdf_path)
        for _ in range(3):
            update_toc(doc)
            replace_referat_page_count(doc, pages)
            update_toc(doc)
            doc.Repaginate()
            doc.Save()
            current_pdf_path = export_pdf(doc, docx_path, pdf_output_path)
            exported_pages = count_pdf_pages(current_pdf_path)
            if exported_pages == pages:
                return pages, current_pdf_path
            pages = exported_pages
        return pages, current_pdf_path
    finally:
        if doc is not None:
            with contextlib.suppress(Exception):
                doc.Close(False)
        if word is not None:
            with contextlib.suppress(Exception):
                word.Quit()


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

        update_toc(doc)

        normalized_tables = normalize_tables(doc)
        centered_images, scaled_images = normalize_inline_images(doc)
        moved_small_tables = keep_small_tables_on_one_page(doc)
        page_placeholder_paragraphs = collect_page_placeholder_paragraphs(doc)
        replace_placeholders(doc, replacements)

        pages = (
            stabilize_page_replacements(doc, page_placeholder_paragraphs, replacements)
            if page_placeholder_paragraphs
            else doc.ComputeStatistics(WD_STATISTIC_PAGES)
        )

        broken_references = find_broken_references(doc)
        if broken_references:
            raise RuntimeError("\n".join(broken_references))

        doc.Save()
        pages = resync_saved_page_replacements(
            doc,
            page_placeholder_paragraphs,
            replacements,
            pages,
        )
        doc.Save()
        pdf_path = export_pdf(doc, docx_path, pdf_output_path)
        pages, pdf_path = resync_pdf_page_replacements(
            doc,
            docx_path,
            pdf_path,
            pdf_output_path,
            page_placeholder_paragraphs,
            replacements,
            pages,
        )

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


def export_docx_to_pdf(
    docx_path: str | Path,
    pdf_output_path: str | Path | None = None,
) -> str:
    word = None
    doc = None
    try:
        word = create_word_application()
        doc = word.Documents.Open(os.path.abspath(str(docx_path)), ReadOnly=True)
        return export_pdf(doc, docx_path, pdf_output_path)
    finally:
        if doc is not None:
            with contextlib.suppress(Exception):
                doc.Close(False)
        if word is not None:
            with contextlib.suppress(Exception):
                word.Quit()
