import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, SMALL_TILDE

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
    """Keep named TeX functions upright before the OMML converter merges runs."""
    root = etree.fromstring(mathml.encode("utf-8"))
    changed = False
    for identifier in root.iter(f"{{{MATHML_NS}}}mi"):
        command = identifier.get("data-latex", "")
        if command.startswith(r"\operatorname{") or command in UPRIGHT_OPERATOR_COMMANDS:
            identifier.tag = f"{{{MATHML_NS}}}mtext"
            changed = True
    return etree.tostring(root, encoding="unicode") if changed else mathml


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

    return [item["mathml"] for item in results]


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

    normalized_values = [normalize_mathml_operators(value) for value in mathml_values]
    results = run_node_json_batch(
        node_script, normalized_values, repo_root, "MathML to OMML conversion"
    )
    failed = [item for item in results if not item.get("ok")]
    if failed:
        first = failed[0]
        raise RuntimeError(
            "MathML to OMML conversion failed for MathML: "
            f"{first.get('mathml')}\n{first.get('error')}"
        )

    return [item["omml"] for item in results]


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
