from pathlib import Path

from lxml import etree

from .constants import MATH_NS
from .docx_package import read_docx_part, rewrite_docx_part
from .markdown_formulas import extract_markdown_formulas
from .math_conversion import convert_mathml_to_omath, latex_to_mathml_batch


def replace_formulas_from_markdown(docx_path: str | Path, report_dir: str | Path) -> int:
    formulas = extract_markdown_formulas(report_dir)
    if not formulas:
        return 0

    document_xml = read_docx_part(docx_path, "word/document.xml")
    parser = etree.XMLParser(resolve_entities=False, remove_blank_text=False)
    document_root = etree.fromstring(document_xml, parser=parser)
    namespace = {"m": MATH_NS}
    existing_formulas = document_root.xpath(".//m:oMath", namespaces=namespace)

    if len(existing_formulas) != len(formulas):
        raise RuntimeError(
            "Formula replacement aborted: Markdown formula count "
            f"({len(formulas)}) does not match DOCX formula count "
            f"({len(existing_formulas)})."
        )

    repo_root = Path(__file__).resolve().parents[2]
    mathml_values = latex_to_mathml_batch(formulas, repo_root)
    new_formulas = convert_mathml_to_omath(mathml_values, repo_root)

    for old_formula, new_formula in zip(existing_formulas, new_formulas, strict=True):
        parent = old_formula.getparent()
        parent.replace(old_formula, new_formula)

    updated_xml = etree.tostring(
        document_root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    rewrite_docx_part(docx_path, "word/document.xml", updated_xml)
    return len(new_formulas)
