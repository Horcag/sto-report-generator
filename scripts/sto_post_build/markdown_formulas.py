from pathlib import Path

from .constants import MATH_PATTERN


def strip_frontmatter(markdown_text: str) -> str:
    if not markdown_text.startswith("---"):
        return markdown_text

    import re

    match = re.match(r"^---\s*\n[\s\S]*?\n---\s*\n?", markdown_text)
    return markdown_text[match.end() :] if match else markdown_text


def normalize_block_formula(formula: str) -> str:
    import re

    formula = formula.strip()
    number_match = re.match(
        r"^(.*?)\s*\((@eq:[a-zA-Z0-9_-]+)\)$",
        formula,
        flags=re.DOTALL,
    )
    if number_match:
        return number_match.group(1).strip()

    plain_number_match = re.match(r"^(.*?)\s*(\(\d+\))$", formula, flags=re.DOTALL)
    if plain_number_match:
        return plain_number_match.group(1).strip()

    return formula


def extract_markdown_formulas(report_dir: str | Path) -> list[str]:
    report_path = Path(report_dir)
    if not report_path.exists() or not report_path.is_dir():
        return []

    formulas: list[str] = []
    for md_path in sorted(report_path.glob("*.md")):
        text = strip_frontmatter(md_path.read_text(encoding="utf-8"))
        for match in MATH_PATTERN.finditer(text):
            if match.group(1) is not None:
                formulas.append(normalize_block_formula(match.group(1)))
            else:
                formulas.append(match.group(2).strip())

    return formulas
