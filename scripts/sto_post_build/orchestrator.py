import os
from pathlib import Path

from .docx_package import clear_dirty_fields
from .formula_replacement import replace_formulas_from_markdown
from .models import PostBuildResult
from .word_automation import run_word_post_build
from .xml_layout import get_counts_from_docx, normalize_docx_xml_layout


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


def create_replacements(figures: int, tables: int, sources: int) -> dict[str, str]:
    return {
        "{{FIGURES}}": count_text(figures, "рисунок", "рисунка", "рисунков"),
        "{{TABLES}}": count_text(tables, "таблица", "таблицы", "таблиц"),
        "{{SOURCES}}": count_text(sources, "источник", "источника", "источников"),
    }


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
        replace_formulas_from_markdown(absolute_docx_path, source_dir)
        if source_dir is not None
        else 0
    )
    table_spacing_changes = normalize_docx_xml_layout(absolute_docx_path)
    counts = get_counts_from_docx(absolute_docx_path)

    word_result = run_word_post_build(
        absolute_docx_path,
        create_replacements(counts.figures, counts.tables, counts.sources),
        pdf_output_path,
    )

    dirty_fields = clear_dirty_fields(absolute_docx_path)
    return PostBuildResult(
        pages=word_result.pages,
        figures=counts.figures,
        tables=counts.tables,
        sources=counts.sources,
        normalized_tables=word_result.normalized_tables,
        centered_images=word_result.centered_images,
        scaled_images=word_result.scaled_images,
        formula_replacements=formula_replacements,
        table_spacing_changes=table_spacing_changes,
        moved_small_tables=word_result.moved_small_tables,
        dirty_fields=dirty_fields,
        pdf_path=word_result.pdf_path,
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
