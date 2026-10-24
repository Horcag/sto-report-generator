import re
from pathlib import Path

from .constants import MATH_PATTERN


def strip_frontmatter(markdown_text: str) -> str:
    if not markdown_text.startswith("---"):
        return markdown_text

    match = re.match(r"^---\s*\n[\s\S]*?\n---\s*\n?", markdown_text)
    return markdown_text[match.end() :] if match else markdown_text


def normalize_block_formula(formula: str) -> str:
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


def without_tex_comments(source: str) -> str:
    result = ""
    index = 0
    while index < len(source):
        if source[index] == "\\" and index + 1 < len(source):
            result += source[index : index + 2]
            index += 2
        elif source[index] == "%":
            while index < len(source) and source[index] != "\n":
                index += 1
            if index < len(source):
                result += "\n"
                index += 1
        else:
            result += source[index]
            index += 1
    return result


def is_single_environment(formula: str, end: int) -> bool:
    stack: list[str] = []
    for token in re.finditer(r"\\(begin|end)\{([A-Za-z*]+)\}", formula):
        if token.group(1) == "begin":
            stack.append(token.group(2))
        elif not stack or stack.pop() != token.group(2):
            return False
        if not stack:
            return token.end() == end
    return False


def split_display_math_lines(source: str) -> list[str]:
    """Match the TypeScript display scanner, preserving nested matrix/cases rows."""
    formula = without_tex_comments(source).strip()
    candidate = re.fullmatch(r"\\begin\{(aligned|gathered)\}([\s\S]*)\\end\{\1\}([,;.]?)", formula)
    outer = (
        candidate
        if candidate and is_single_environment(formula, len(formula) - len(candidate.group(3)))
        else None
    )
    if outer:
        formula = outer.group(2) + outer.group(3)
    if outer and re.match(r"\s*\[", formula):
        raise RuntimeError("Display alignment options are not supported.")
    lines: list[str] = []
    line = ""
    braces = 0
    environments = 0
    index = 0
    while index < len(formula):
        rest = formula[index:]
        environment = re.match(r"\\(begin|end)\{[A-Za-z*]+\}", rest)
        if environment:
            environments += 1 if environment.group(1) == "begin" else -1
            line += environment.group(0)
            index += len(environment.group(0))
            continue
        if rest.startswith(r"\\") and braces == 0 and environments == 0:
            if rest[2:3] == "*":
                raise RuntimeError("Display nonbreaking row modifiers are not supported.")
            if re.match(r"\s*\[", rest[2:]):
                raise RuntimeError("Display line spacing options are not supported.")
            lines.append(line.strip())
            line = ""
            index += 2
            continue
        if formula[index] == "\\" and index + 1 < len(formula) and formula[index + 1] in "{}&":
            line += formula[index : index + 2]
            index += 2
            continue
        if formula[index] == "{":
            braces += 1
        if formula[index] == "}":
            braces -= 1
        if not (outer and formula[index] == "&" and braces == 0 and environments == 0):
            line += formula[index]
        index += 1
    lines.append(line.strip())
    if any(not value for value in lines):
        raise RuntimeError("Display formula contains an empty continuation line.")
    return lines


def extract_markdown_formulas(report_dir: str | Path) -> list[str]:
    report_path = Path(report_dir)
    if not report_path.exists() or not report_path.is_dir():
        return []

    formulas: list[str] = []
    for md_path in sorted(report_path.glob("*.md")):
        text = strip_frontmatter(md_path.read_text(encoding="utf-8"))
        for match in MATH_PATTERN.finditer(text):
            if match.group(1) is not None:
                formulas.extend(split_display_math_lines(normalize_block_formula(match.group(1))))
            else:
                formulas.append(match.group(2).strip())

    return formulas
