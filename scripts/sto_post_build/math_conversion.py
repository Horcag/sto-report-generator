import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, SMALL_TILDE


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

(async () => {
  const mathjax = require('mathjax');
  const formulas = JSON.parse(fs.readFileSync(0, 'utf8'));
  const MathJax = await mathjax.init({ loader: { load: ['input/tex'] } });
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

    results = run_node_json_batch(
        node_script, mathml_values, repo_root, "MathML to OMML conversion"
    )
    failed = [item for item in results if not item.get("ok")]
    if failed:
        first = failed[0]
        raise RuntimeError(
            "MathML to OMML conversion failed for MathML: "
            f"{first.get('mathml')}\n{first.get('error')}"
        )

    return [item["omml"] for item in results]


def fix_tilde_accents(root: Any) -> int:
    namespace = {"m": MATH_NS}
    fixed = 0

    for lim_upp in root.xpath(".//m:limUpp", namespaces=namespace):
        accent_text = "".join(lim_upp.xpath("./m:lim//m:t/text()", namespaces=namespace)).strip()
        if accent_text not in {"~", SMALL_TILDE}:
            continue

        base = lim_upp.find(f"{{{MATH_NS}}}e")
        if base is None:
            continue

        accent = etree.Element(f"{{{MATH_NS}}}acc")
        accent_pr = etree.SubElement(accent, f"{{{MATH_NS}}}accPr")
        accent_chr = etree.SubElement(accent_pr, f"{{{MATH_NS}}}chr")
        accent_chr.set(f"{{{MATH_NS}}}val", SMALL_TILDE)
        accent.append(etree.fromstring(etree.tostring(base)))

        parent = lim_upp.getparent()
        if parent is None:
            continue
        parent.replace(lim_upp, accent)
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
        fix_tilde_accents(omath_copy)
        omath_values.append(omath_copy)

    return omath_values
