import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from lxml import etree

from .constants import MATH_NS, MATH_XSL_PATH, SMALL_TILDE


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

    completed = subprocess.run(
        ["node", "-e", node_script],
        input=json.dumps(list(formulas), ensure_ascii=False),
        capture_output=True,
        encoding="utf-8",
        cwd=str(repo_root),
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("MathJax conversion failed:\n" + completed.stderr.strip())

    results = json.loads(completed.stdout)
    failed = [item for item in results if not item.get("ok")]
    if failed:
        first = failed[0]
        raise RuntimeError(
            f"MathJax failed for formula: {first.get('formula')}\n{first.get('error')}"
        )

    return [item["mathml"] for item in results]


def fix_tilde_accents(root: Any) -> int:
    namespace = {"m": MATH_NS}
    fixed = 0

    for lim_upp in list(root.xpath(".//m:limUpp", namespaces=namespace)):
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


def convert_mathml_to_omath(mathml_values: Sequence[str]) -> list[Any]:
    if not mathml_values:
        return []
    if not MATH_XSL_PATH.exists():
        raise RuntimeError(f"Office MathML converter not found: {MATH_XSL_PATH}")

    parser = etree.XMLParser(resolve_entities=False, recover=False)
    transform = etree.XSLT(etree.parse(str(MATH_XSL_PATH)))
    namespace = {"m": MATH_NS}
    omath_values: list[Any] = []

    for mathml in mathml_values:
        mathml_root = etree.fromstring(mathml.encode("utf-8"), parser=parser)
        omml_tree = transform(mathml_root)
        omath = omml_tree.getroot()
        if omath.tag != f"{{{MATH_NS}}}oMath":
            nested = omath.xpath(".//m:oMath", namespaces=namespace)
            if not nested:
                raise RuntimeError("Converted formula does not contain m:oMath.")
            omath = nested[0]
        omath_copy = etree.fromstring(etree.tostring(omath))
        fix_tilde_accents(omath_copy)
        omath_values.append(omath_copy)

    return omath_values
