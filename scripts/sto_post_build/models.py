from dataclasses import dataclass


@dataclass(frozen=True)
class DocumentCounts:
    figures: int
    tables: int
    sources: int


@dataclass(frozen=True)
class WordPostBuildResult:
    pages: int
    normalized_tables: int
    centered_images: int
    scaled_images: int
    moved_small_tables: int
    pdf_path: str


@dataclass(frozen=True)
class PostBuildResult:
    pages: int
    figures: int
    tables: int
    sources: int
    normalized_tables: int
    centered_images: int
    scaled_images: int
    formula_replacements: int
    table_spacing_changes: int
    moved_small_tables: int
    dirty_fields: int
    pdf_path: str
