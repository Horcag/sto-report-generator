"""Bounded main-story Word range queries without global COM enumeration."""

import re
from typing import Any

from .constants import BROKEN_REFERENCE_MARKERS


def collect_page_placeholder_paragraphs(doc: Any) -> list[tuple[Any, str]]:
    paragraphs: dict[int, tuple[Any, str]] = {}
    story_end = doc.Content.End
    for token in ("{{PAGES}}", "{{PAGES_WORD}}"):
        search = doc.Content
        while search.Find.Execute(
            FindText=token,
            MatchCase=True,
            MatchWholeWord=False,
            MatchWildcards=False,
            Forward=True,
            Wrap=0,
            Format=False,
        ):
            paragraph = search.Paragraphs(1)
            paragraph_range = paragraph.Range
            paragraphs[paragraph_range.Start] = (paragraph, paragraph_range.Text.rstrip("\r\x07"))
            next_start = search.End
            if next_start >= story_end:
                break
            search = doc.Range(next_start, story_end)
    return [paragraphs[start] for start in sorted(paragraphs)]


def previous_paragraph_before(doc: Any, position: int) -> Any | None:
    if position <= 0:
        return None
    try:
        paragraph = doc.Range(position - 1, position - 1).Paragraphs(1)
        paragraph_range = paragraph.Range
        if paragraph_range.End <= position:
            return paragraph
        # An interior position excludes the containing paragraph, as the old scan did.
        if paragraph_range.Start <= 0:
            return None
        previous = doc.Range(paragraph_range.Start - 1, paragraph_range.Start - 1).Paragraphs(1)
        if previous.Range.End <= position:
            return previous
    except Exception:
        pass
    # Preserve the former semantics for invalid positions or unusual COM ranges.
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


def find_broken_references(doc: Any) -> list[str]:
    errors: list[str] = []
    # Transfer the main story once. Manual line breaks remain inside a paragraph;
    # a table cell's end marker belongs to its preceding paragraph.
    for text in re.findall(r"[^\r]*(?:\r\x07?|\Z)", doc.Content.Text):
        if any(marker in text for marker in BROKEN_REFERENCE_MARKERS):
            errors.append(f"CRITICAL: Broken reference or source found: {text.strip()}")
    return errors
