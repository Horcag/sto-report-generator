import json
import subprocess
from collections.abc import Sequence
from copy import deepcopy
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, SMALL_TILDE, WORD_NS

ACCENT_CHARS = {
    "~": "\u0303",  # combining tilde
    SMALL_TILDE: "\u0303",
    "^": "\u0302",  # combining circumflex
    "→": "\u20d7",  # combining right arrow above
    "˙": "\u0307",  # combining dot above
    "¨": "\u0308",  # combining diaeresis
}
OVERBAR_CHARS = {"¯", "―"}
MATHML_NS = "http://www.w3.org/1998/Math/MathML"
EXPLICIT_MATH_SPACES = {
    r"\quad": ("\ue000", "\u2003"),
    r"\qquad": ("\ue001", "\u2003\u2003"),
}
UPRIGHT_OPERATOR_COMMANDS = {
    r"\arccos",
    r"\arcsin",
    r"\arctan",
    r"\cos",
    r"\cosh",
    r"\exp",
    r"\lg",
    r"\lim",
    r"\ln",
    r"\log",
    r"\max",
    r"\min",
    r"\sin",
    r"\sinh",
    r"\sup",
    r"\tan",
    r"\tanh",
}


def normalize_mathml_operators(mathml: str) -> str:
    """Preserve named functions and explicit TeX spacing through run merging."""
    root = etree.fromstring(mathml.encode("utf-8"))
    changed = False
    for identifier in root.iter(f"{{{MATHML_NS}}}mi"):
        command = identifier.get("data-latex", "")
        if command.startswith(r"\operatorname{") or command in UPRIGHT_OPERATOR_COMMANDS:
            identifier.tag = f"{{{MATHML_NS}}}mtext"
            changed = True
    for space in root.iter(f"{{{MATHML_NS}}}mspace"):
        replacement = EXPLICIT_MATH_SPACES.get(space.get("data-latex", ""))
        if replacement is None:
            continue
        marker = etree.Element(f"{{{MATHML_NS}}}mi")
        marker.text = replacement[0]
        marker.tail = space.tail
        space.getparent().replace(space, marker)
        changed = True
    # The converter trims literal NBSPs, but retains MathJax's numeric references.
    return (
        etree.tostring(root, encoding="unicode").replace("\u00a0", "&#xA0;") if changed else mathml
    )


def mark_mathml_fences(mathml: str) -> tuple[str, list[dict[str, str]]]:
    """Carry paired scalable MathJax fences through plain-text operator conversion."""
    root = etree.fromstring(mathml.encode("utf-8"))
    prefix = "\ue100FENCE"
    while prefix in "".join(root.itertext()):
        prefix += "X"
    fences: list[dict[str, str]] = []
    for row in reversed(list(root.iter(f"{{{MATHML_NS}}}mrow"))):
        if row.get("data-mjx-texclass") != "INNER" or len(row) < 3:
            continue
        first, last = row[0], row[-1]
        if (
            first.tag != f"{{{MATHML_NS}}}mo"
            or last.tag != f"{{{MATHML_NS}}}mo"
            or first.get("data-mjx-texclass") != "OPEN"
            or last.get("data-mjx-texclass") != "CLOSE"
            or first.get("stretchy") == "false"
            or last.get("stretchy") == "false"
        ):
            continue
        fence = {
            "open": f"{prefix}{len(fences)}OPEN\ue101",
            "close": f"{prefix}{len(fences)}CLOSE\ue101",
            "begin": first.text or "",
            "end": last.text or "",
        }
        first.text, last.text = fence["open"], fence["close"]
        fences.append(fence)
    if not fences:
        return mathml, fences
    return etree.tostring(root, encoding="unicode").replace("\u00a0", "&#xA0;"), fences


def restore_omml_fences(omml: str, fences: list[dict[str, str]]) -> str:
    if not fences:
        return omml
    root = etree.fromstring(omml.encode("utf-8"))
    tokens = {fence[key] for fence in fences for key in ("open", "close")}
    markers: dict[str, Any] = {}
    # The converter merges markers with adjacent text. Split only marked runs,
    # keeping all formatting on the neighbouring non-fence text.
    for text in list(root.iter(f"{{{MATH_NS}}}t")):
        remaining = text.text or ""
        if not any(token in remaining for token in tokens):
            continue
        run = text.getparent()
        if run is None or run.tag != f"{{{MATH_NS}}}r":
            raise RuntimeError("Malformed formula fence marker.")
        parent = run.getparent()
        if parent is None:
            raise RuntimeError("Formula fence marker has no expression container.")
        while remaining:
            found = sorted(
                (remaining.index(token), token) for token in tokens if token in remaining
            )
            chunks = [remaining[: found[0][0]], found[0][1]] if found else [remaining]
            for chunk in filter(None, chunks):
                clone = deepcopy(run)
                clone.find(f"{{{MATH_NS}}}t").text = chunk
                clone.tail = None
                run.addprevious(clone)
                if chunk in tokens:
                    if chunk in markers:
                        raise RuntimeError("Duplicate formula fence marker.")
                    markers[chunk] = clone
            remaining = remaining[found[0][0] + len(found[0][1]) :] if found else ""
        previous = run.getprevious()
        if run.tail and previous is not None:
            previous.tail = run.tail
        parent.remove(run)
    for fence in fences:
        if fence["open"] not in markers or fence["close"] not in markers:
            raise RuntimeError("Formula fences lost their shared expression container.")
        opening, closing = markers[fence["open"]], markers[fence["close"]]
        if opening.getparent() is not closing.getparent():
            raise RuntimeError("Formula fences lost their shared expression container.")
        closing_tail = closing.tail
        contents = []
        node = opening.getnext()
        while node is not None and node is not closing:
            contents.append(node)
            node = node.getnext()
        if node is not closing or not contents:
            raise RuntimeError("Formula fences lost their enclosed expression.")
        delimiter = etree.Element(f"{{{MATH_NS}}}d")
        properties = etree.SubElement(delimiter, f"{{{MATH_NS}}}dPr")
        for name, value in (("begChr", fence["begin"]), ("endChr", fence["end"]), ("grow", "1")):
            property_element = etree.SubElement(properties, f"{{{MATH_NS}}}{name}")
            property_element.set(f"{{{MATH_NS}}}val", value)
        run_properties = opening.find(f"{{{WORD_NS}}}rPr")
        if run_properties is not None:
            control = etree.SubElement(properties, f"{{{MATH_NS}}}ctrlPr")
            control.append(deepcopy(run_properties))
        expression = etree.SubElement(delimiter, f"{{{MATH_NS}}}e")
        for child in contents:
            expression.append(child)
        parent = opening.getparent()
        parent.replace(opening, delimiter)
        delimiter.tail = closing_tail
        parent.remove(closing)
    return etree.tostring(root, encoding="unicode")


def collect_matrix_alignments(mathml: str) -> list[dict[str, Any]]:
    """Capture source table alignment before the converter defaults every column to center."""
    root = etree.fromstring(mathml.encode("utf-8"))
    matrices = list(root.iter(f"{{{MATHML_NS}}}mtable"))
    result = []
    for matrix in matrices:
        rows = matrix.findall(f"{{{MATHML_NS}}}mtr")
        lengths = [len(row.findall(f"{{{MATHML_NS}}}mtd")) for row in rows]
        if not rows or len(rows) != len(matrix) or any(length == 0 for length in lengths):
            raise RuntimeError("Unsupported MathML matrix row structure.")
        alignments = matrix.get("columnalign", "center").split() or ["center"]
        if any(value not in {"left", "center", "right"} for value in alignments):
            raise RuntimeError("Unsupported MathML matrix column alignment.")
        parent = next(
            (matrices.index(node) for node in matrix.iterancestors() if node in matrices), None
        )
        result.append(
            {
                "columns": [
                    alignments[min(index, len(alignments) - 1)] for index in range(max(lengths))
                ],
                "row_lengths": lengths,
                "parent": parent,
            }
        )
    return result


def restore_matrix_alignments(omml: str, source: list[dict[str, Any]]) -> str:
    """Restore alignment only when matrix count, nesting and dimensions survived conversion."""
    root = etree.fromstring(omml.encode("utf-8"))
    matrices = list(root.iter(f"{{{MATH_NS}}}m"))
    if len(matrices) != len(source):
        raise RuntimeError("MathML/OMML matrix count mismatch.")
    for matrix, expected in zip(matrices, source, strict=True):
        parent = next(
            (matrices.index(node) for node in matrix.iterancestors() if node in matrices), None
        )
        lengths = [
            len(row.findall(f"{{{MATH_NS}}}e")) for row in matrix.findall(f"{{{MATH_NS}}}mr")
        ]
        if parent != expected["parent"] or lengths != expected["row_lengths"]:
            raise RuntimeError("MathML/OMML matrix nesting or dimensions mismatch.")
        properties = matrix.find(f"{{{MATH_NS}}}mPr")
        if properties is None:
            properties = etree.Element(f"{{{MATH_NS}}}mPr")
            matrix.insert(0, properties)
        for old in properties.findall(f"{{{MATH_NS}}}mcs"):
            properties.remove(old)
        columns = etree.Element(f"{{{MATH_NS}}}mcs")
        index = 0
        while index < len(expected["columns"]):
            alignment = expected["columns"][index]
            end = index + 1
            while end < len(expected["columns"]) and expected["columns"][end] == alignment:
                end += 1
            group = etree.SubElement(columns, f"{{{MATH_NS}}}mc")
            group_properties = etree.SubElement(group, f"{{{MATH_NS}}}mcPr")
            for name, value in (("count", str(end - index)), ("mcJc", alignment)):
                property_element = etree.SubElement(group_properties, f"{{{MATH_NS}}}{name}")
                property_element.set(f"{{{MATH_NS}}}val", value)
            index = end
        control = properties.find(f"{{{MATH_NS}}}ctrlPr")
        properties.insert(
            properties.index(control) if control is not None else len(properties), columns
        )
    return etree.tostring(root, encoding="unicode")


def run_node_json_batch(
    node_script: str,
    values: Sequence[str],
    repo_root: Path,
    conversion_name: str,
) -> list[dict[str, Any]]:
    completed = subprocess.run(
        ["node", "-e", node_script],
        input=json.dumps(list(values), ensure_ascii=False),
        capture_output=True,
        encoding="utf-8",
        cwd=str(repo_root),
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{conversion_name} failed:\n" + completed.stderr.strip())

    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"{conversion_name} produced invalid JSON:\n{completed.stdout}"
        ) from error

    if not isinstance(result, list):
        raise RuntimeError(f"{conversion_name} produced an unexpected JSON payload.")

    return result


def latex_to_mathml_batch(formulas: Sequence[str], repo_root: Path) -> list[str]:
    if not formulas:
        return []

    node_script = r"""
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mathjax = require('mathjax');
  const formulas = JSON.parse(fs.readFileSync(0, 'utf8'));
  const MathJax = await mathjax.init({
    loader: {
      load: ['input/tex'],
      require: (file) => import(path.isAbsolute(file) ? pathToFileURL(file).href : file),
    },
    tex: { macros: {
      stovec: ['\\mathbf{#1}', 1],
      stomat: ['\\mathbf{#1}', 1],
      stotemp: ['\\text{#1}', 1],
      stoelem: ['\\text{#1}', 1],
      stoabbr: ['\\text{#1}', 1],
    } },
  });
  const result = formulas.map((formula) => {
    try {
      return { ok: true, mathml: MathJax.tex2mml(formula) };
    } catch (error) {
      return { ok: false, error: String(error), formula };
    }
  });
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
"""

    results = run_node_json_batch(node_script, formulas, repo_root, "MathJax conversion")
    failed = [item for item in results if not item.get("ok")]
    if failed:
        first = failed[0]
        raise RuntimeError(
            f"MathJax failed for formula: {first.get('formula')}\n{first.get('error')}"
        )

    values = [item["mathml"] for item in results]
    for formula, mathml in zip(formulas, values, strict=True):
        root = etree.fromstring(mathml.encode("utf-8"))
        for error in root.iter(f"{{{MATHML_NS}}}merror"):
            reason = error.get("data-mjx-error") or "".join(error.itertext())
            raise RuntimeError(f"MathJax failed for formula: {formula}\n{reason}")
        for text in root.iter(f"{{{MATHML_NS}}}mtext"):
            command = text.get("data-latex", "")
            if text.get("mathcolor") == "red" and command.startswith("\\"):
                raise RuntimeError(
                    f"MathJax failed for formula: {formula}\nUnknown TeX command {command}"
                )
    return values


def mathml_to_omml_batch(mathml_values: Sequence[str], repo_root: Path) -> list[str]:
    if not mathml_values:
        return []

    node_script = r"""
const fs = require('fs');
const { mml2omml } = require('@hungknguyen/mathml2omml');

const mathmlValues = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = mathmlValues.map((mathml) => {
  try {
    return { ok: true, omml: mml2omml(mathml, { disableDecode: true }) };
  } catch (error) {
    return { ok: false, error: String(error), mathml };
  }
});
process.stdout.write(JSON.stringify(result));
"""

    marked_values = [
        mark_mathml_fences(normalize_mathml_operators(value)) for value in mathml_values
    ]
    results = run_node_json_batch(
        node_script, [value for value, _ in marked_values], repo_root, "MathML to OMML conversion"
    )
    failed = [item for item in results if not item.get("ok")]
    if failed:
        first = failed[0]
        raise RuntimeError(
            "MathML to OMML conversion failed for MathML: "
            f"{first.get('mathml')}\n{first.get('error')}"
        )

    values = [
        restore_matrix_alignments(
            restore_omml_fences(item["omml"], fences), collect_matrix_alignments(mathml)
        )
        for item, (_, fences), mathml in zip(results, marked_values, mathml_values, strict=True)
    ]
    for marker, spacing in EXPLICIT_MATH_SPACES.values():
        values = [value.replace(marker, spacing) for value in values]
    return values


def normalize_accents(root: Any) -> int:
    namespace = {"m": MATH_NS}
    fixed = 0

    for lim_upp in root.xpath(".//m:limUpp", namespaces=namespace):
        accent_text = "".join(lim_upp.xpath("./m:lim//m:t/text()", namespaces=namespace)).strip()
        if accent_text not in ACCENT_CHARS and accent_text not in OVERBAR_CHARS:
            continue

        base = lim_upp.find(f"{{{MATH_NS}}}e")
        if base is None:
            continue

        if accent_text in OVERBAR_CHARS:
            accent = etree.Element(f"{{{MATH_NS}}}bar")
            properties = etree.SubElement(accent, f"{{{MATH_NS}}}barPr")
            position = etree.SubElement(properties, f"{{{MATH_NS}}}pos")
            position.set(f"{{{MATH_NS}}}val", "top")
        else:
            accent = etree.Element(f"{{{MATH_NS}}}acc")
            properties = etree.SubElement(accent, f"{{{MATH_NS}}}accPr")
            character = etree.SubElement(properties, f"{{{MATH_NS}}}chr")
            character.set(f"{{{MATH_NS}}}val", ACCENT_CHARS[accent_text])
        accent.append(etree.fromstring(etree.tostring(base)))

        parent = lim_upp.getparent()
        if parent is None:
            continue
        parent.replace(lim_upp, accent)
        fixed += 1

    # The converter may produce m:bar directly, so normalize after both paths.
    for accent in root.xpath(".//m:bar | .//m:acc", namespaces=namespace):
        base = accent.find(f"{{{MATH_NS}}}e")
        if (
            base is None
            or len(base) != 1
            or base[0].tag
            not in {
                f"{{{MATH_NS}}}sSup",
                f"{{{MATH_NS}}}sSub",
            }
        ):
            continue
        script = base[0]
        argument = script.find(f"{{{MATH_NS}}}e")
        index = script.find(f"{{{MATH_NS}}}sup")
        if index is None:
            index = script.find(f"{{{MATH_NS}}}sub")
        if argument is not None and index is not None and len(index) == 0:
            base.remove(script)
            for child in list(argument):
                argument.remove(child)
                base.append(child)

    return fixed


def normalize_limit_operators(root: Any) -> int:
    namespaces = {"m": MATH_NS}
    fixed = 0
    for run in root.xpath(".//m:limLow/m:e/m:r | .//m:limUpp/m:e/m:r", namespaces=namespaces):
        if "".join(run.xpath("./m:t/text()", namespaces=namespaces)).strip() not in {
            "min",
            "max",
            "lim",
            "inf",
            "sup",
        }:
            continue
        properties = run.find(f"{{{MATH_NS}}}rPr")
        if properties is None:
            properties = etree.Element(f"{{{MATH_NS}}}rPr")
            run.insert(0, properties)
        if properties.find(f"{{{MATH_NS}}}nor") is None:
            etree.SubElement(properties, f"{{{MATH_NS}}}nor")
            fixed += 1
    return fixed


def parse_omath(omml: str, parser: Any) -> Any:
    omath = etree.fromstring(omml.encode("utf-8"), parser=parser)
    if omath.tag == f"{{{MATH_NS}}}oMath":
        return omath

    nested = omath.xpath(".//m:oMath", namespaces={"m": MATH_NS})
    if not nested:
        raise RuntimeError("Converted formula does not contain m:oMath.")
    return nested[0]


def convert_mathml_to_omath(mathml_values: Sequence[str], repo_root: Path) -> list[Any]:
    omml_values = mathml_to_omml_batch(mathml_values, repo_root)
    if not omml_values:
        return []

    parser = etree.XMLParser(resolve_entities=False, recover=False)
    omath_values: list[Any] = []

    for omml in omml_values:
        omath = parse_omath(omml, parser)
        omath_copy = etree.fromstring(etree.tostring(omath))
        normalize_accents(omath_copy)
        normalize_limit_operators(omath_copy)
        omath_values.append(omath_copy)

    return omath_values
