import os
from pathlib import Path

from lxml import etree

from .constants import WORD_NS
from .docx_package import assert_no_statistic_placeholders, clear_dirty_fields, read_docx_part
from .formula_replacement import replace_formulas_from_markdown
from .models import PostBuildResult
from .statistics import get_counts_from_docx
from .timing import timed_stage
from .word_automation import (
    count_pdf_pages,
    export_docx_to_pdf,
    resync_docx_page_count_from_pdf,
    run_word_post_build,
)
from .xml_layout import (
    normalize_docx_xml_layout,
    normalize_front_matter_table_geometry,
)


def select_source_dir(docx_path: str | Path, report_source_dir: str | Path | None) -> Path | None:
    candidate_source_dir = Path(report_source_dir) if report_source_dir else Path(docx_path).parent
    return candidate_source_dir if any(candidate_source_dir.glob("*.md")) else None


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


def count_text(count: int, form1: str, form2: str, form5: str) -> str:
    return f"{count} {pluralize_ru(count, form1, form2, form5)}" if count > 0 else ""


def create_replacements(
    figures: int, tables: int, sources: int, appendices: int = 0
) -> dict[str, str]:
    return {
        "{{FIGURES}}": count_text(figures, "рисунок", "рисунка", "рисунков"),
        "{{TABLES}}": count_text(tables, "таблица", "таблицы", "таблиц"),
        "{{SOURCES}}": count_text(sources, "источник", "источника", "источников"),
        "{{APPENDICES}}": (
            f"{appendices} {pluralize_ru(appendices, 'приложение', 'приложения', 'приложений')}"
        ),
    }


def has_legacy_page_count(docx_path: str | Path) -> bool:
    """Retain legacy plain-text referat correction, even without template tokens."""
    root = etree.fromstring(read_docx_part(docx_path, "word/document.xml"))
    return any(
        "".join(node.text or "" for node in paragraph.iter(f"{{{WORD_NS}}}t")).startswith(
            "Отчет по практике содержит "
        )
        for paragraph in root.iter(f"{{{WORD_NS}}}p")
    )


def post_build(
    docx_path: str | Path,
    report_source_dir: str | Path | None = None,
    pdf_output_path: str | Path | None = None,
) -> PostBuildResult:
    absolute_docx_path = os.path.abspath(str(docx_path))
    if not os.path.exists(absolute_docx_path):
        raise FileNotFoundError(f"File not found - {absolute_docx_path}")

    source_dir = select_source_dir(absolute_docx_path, report_source_dir)
    formula_replacements = (
        timed_stage(
            "source-formulas", replace_formulas_from_markdown, absolute_docx_path, source_dir
        )
        if source_dir is not None
        else 0
    )
    table_spacing_changes = timed_stage("xml-layout", normalize_docx_xml_layout, absolute_docx_path)
    counts = timed_stage("xml-counts", get_counts_from_docx, absolute_docx_path)

    word_result = timed_stage(
        "native-post-build",
        run_word_post_build,
        absolute_docx_path,
        create_replacements(counts.figures, counts.tables, counts.sources, counts.appendices),
        pdf_output_path,
    )

    front_matter_table_changes = normalize_front_matter_table_geometry(absolute_docx_path)
    dirty_fields = clear_dirty_fields(absolute_docx_path)
    pdf_path = word_result.pdf_path
    if front_matter_table_changes:
        pdf_path = export_docx_to_pdf(absolute_docx_path, pdf_output_path)
    final_pages = count_pdf_pages(pdf_path)
    if (
        front_matter_table_changes
        or final_pages != word_result.pages
        or has_legacy_page_count(absolute_docx_path)
    ):
        final_pages, pdf_path = timed_stage(
            "post-xml-page-resync",
            resync_docx_page_count_from_pdf,
            absolute_docx_path,
            pdf_path,
            pdf_output_path,
        )
    else:
        print(
            "Word post-build: saved DOCX/PDF pages agree; no post-XML layout resync needed.",
            flush=True,
        )
    assert_no_statistic_placeholders(absolute_docx_path)

    return PostBuildResult(
        pages=final_pages,
        figures=counts.figures,
        tables=counts.tables,
        sources=counts.sources,
        normalized_tables=word_result.normalized_tables,
        centered_images=word_result.centered_images,
        scaled_images=word_result.scaled_images,
        formula_replacements=formula_replacements,
        table_spacing_changes=table_spacing_changes + front_matter_table_changes,
        moved_small_tables=word_result.moved_small_tables,
        dirty_fields=dirty_fields,
        pdf_path=pdf_path,
    )


def format_post_build_summary(result: PostBuildResult) -> str:
    return (
        f"Post-build complete: {result.pages} pages, {result.figures} figures, "
        f"{result.tables} tables, {result.sources} sources; "
        f"table headers: {result.normalized_tables}, centered images: {result.centered_images}, "
        f"scaled images: {result.scaled_images}, formulas replaced: {result.formula_replacements}, "
        f"table spacing adjusted: {result.table_spacing_changes}, "
        f"moved small tables: {result.moved_small_tables}, dirty fields cleared: "
        f"{result.dirty_fields}, PDF exported: {result.pdf_path}."
    )
