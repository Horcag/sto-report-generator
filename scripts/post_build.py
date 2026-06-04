import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import win32com.client
from lxml import etree

WD_ALIGN_PARAGRAPH_CENTER = 1
WD_ACTIVE_END_PAGE_NUMBER = 3
WD_EXPORT_FORMAT_PDF = 17
MAX_IMAGE_WIDTH_POINTS = 14 / 2.54 * 72
DIRTY_TRUE_RE = re.compile(r'w:dirty="(?:true|1)"')
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MATH_XSL_PATH = Path(r"C:\Program Files\Microsoft Office\root\Office16\MML2OMML.XSL")
MATH_PATTERN = re.compile(r"\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$")
SPACING_AFTER_TABLE_TWIPS = "120"
SMALL_TILDE = "\u02dc"


def strip_frontmatter(markdown_text):
    if markdown_text.startswith("---"):
        match = re.match(r"^---\s*\n[\s\S]*?\n---\s*\n?", markdown_text)
        if match:
            return markdown_text[match.end() :]
    return markdown_text


def normalize_block_formula(formula):
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


def extract_markdown_formulas(report_dir):
    report_path = Path(report_dir)
    if not report_path.exists() or not report_path.is_dir():
        return []

    formulas = []
    for md_path in sorted(report_path.glob("*.md")):
        text = strip_frontmatter(md_path.read_text(encoding="utf-8"))
        for match in MATH_PATTERN.finditer(text):
            if match.group(1) is not None:
                formulas.append(normalize_block_formula(match.group(1)))
            else:
                formulas.append(match.group(2).strip())

    return formulas


def latex_to_mathml_batch(formulas, repo_root):
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
        input=json.dumps(formulas, ensure_ascii=False),
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


def convert_mathml_to_omath(mathml_values):
    if not mathml_values:
        return []
    if not MATH_XSL_PATH.exists():
        raise RuntimeError(f"Office MathML converter not found: {MATH_XSL_PATH}")

    parser = etree.XMLParser(resolve_entities=False, recover=False)
    transform = etree.XSLT(etree.parse(str(MATH_XSL_PATH)))
    namespace = {"m": MATH_NS}
    omath_values = []

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


def fix_tilde_accents(root):
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


def get_or_create_child(parent, tag, insert_index=None):
    child = parent.find(tag)
    if child is not None:
        return child

    child = etree.Element(tag)
    if insert_index is None:
        parent.append(child)
    else:
        parent.insert(insert_index, child)
    return child


def paragraph_style(paragraph):
    namespace = {"w": WORD_NS}
    values = paragraph.xpath("./w:pPr/w:pStyle/@w:val", namespaces=namespace)
    return values[0] if values else ""


def paragraph_has_visible_content(paragraph):
    namespace = {"w": WORD_NS}
    text = "".join(paragraph.xpath(".//w:t/text()", namespaces=namespace)).strip()
    has_drawing = bool(paragraph.xpath(".//w:drawing", namespaces=namespace))
    return bool(text or has_drawing)


def set_paragraph_space_before(paragraph, value):
    p_pr = paragraph.find(f"{{{WORD_NS}}}pPr")
    if p_pr is None:
        p_pr = etree.Element(f"{{{WORD_NS}}}pPr")
        paragraph.insert(0, p_pr)

    spacing = p_pr.find(f"{{{WORD_NS}}}spacing")
    if spacing is None:
        spacing = etree.Element(f"{{{WORD_NS}}}spacing")
        p_pr.append(spacing)

    before_key = f"{{{WORD_NS}}}before"
    current = spacing.get(before_key)
    if current is None or int(current) < int(value):
        spacing.set(before_key, value)


def add_spacing_after_data_tables(document_root):
    namespace = {"m": MATH_NS, "w": WORD_NS}
    body = document_root.find(f"{{{WORD_NS}}}body")
    if body is None:
        return 0

    elements = list(body)
    changed = 0
    for index, element in enumerate(elements):
        if element.tag != f"{{{WORD_NS}}}tbl":
            continue
        if element.xpath(".//m:oMath", namespaces=namespace):
            continue

        for following in elements[index + 1 :]:
            if following.tag == f"{{{WORD_NS}}}p" and paragraph_has_visible_content(following):
                style = paragraph_style(following)
                if not style.startswith("Heading") and style not in {
                    "TableCaption",
                    "FigureCaption",
                }:
                    set_paragraph_space_before(following, SPACING_AFTER_TABLE_TWIPS)
                    changed += 1
                break
            if following.tag == f"{{{WORD_NS}}}tbl":
                break

    return changed


def rewrite_docx_part(docx_path, part_name, part_bytes):
    with zipfile.ZipFile(docx_path, "r") as zf:
        names = zf.namelist()
        files = {name: zf.read(name) for name in names}

    files[part_name] = part_bytes
    fd, temp_name = tempfile.mkstemp(suffix=".docx", dir=str(Path(docx_path).parent))
    os.close(fd)
    Path(temp_name).unlink()
    try:
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                zout.writestr(name, files[name])
        shutil.move(temp_name, docx_path)
    except Exception:
        if Path(temp_name).exists():
            Path(temp_name).unlink()
        raise


def replace_formulas_from_markdown(docx_path, report_dir):
    formulas = extract_markdown_formulas(report_dir)
    if not formulas:
        return 0

    with zipfile.ZipFile(docx_path, "r") as zf:
        document_xml = zf.read("word/document.xml")

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

    repo_root = Path(__file__).resolve().parents[1]
    mathml_values = latex_to_mathml_batch(formulas, repo_root)
    new_formulas = convert_mathml_to_omath(mathml_values)

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


def normalize_docx_xml_layout(docx_path):
    with zipfile.ZipFile(docx_path, "r") as zf:
        document_xml = zf.read("word/document.xml")

    parser = etree.XMLParser(resolve_entities=False, remove_blank_text=False)
    document_root = etree.fromstring(document_xml, parser=parser)
    table_spacing_changes = add_spacing_after_data_tables(document_root)

    if table_spacing_changes == 0:
        return 0

    updated_xml = etree.tostring(
        document_root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )
    rewrite_docx_part(docx_path, "word/document.xml", updated_xml)
    return table_spacing_changes


def get_counts_from_docx(docx_path):
    figures = 0
    tables = 0
    sources = 0

    with tempfile.TemporaryDirectory() as temp_dir:
        with zipfile.ZipFile(docx_path, "r") as zf:
            zf.extractall(temp_dir)

        doc_path = Path(temp_dir) / "word" / "document.xml"
        if not doc_path.exists():
            return 0, 0, 0

        tree = etree.parse(str(doc_path))
        root = tree.getroot()
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

        for p in root.xpath(".//w:p", namespaces=ns):
            pStyle = p.xpath(".//w:pStyle/@w:val", namespaces=ns)
            if pStyle:
                style = pStyle[0]
                if style == "FigureCaption":
                    figures += 1
                elif style == "TableCaption":
                    tables += 1

        # Count sources by the highest citation marker found in text: [1], [1, 2], etc.
        max_source = 0
        for t in root.xpath(".//w:t/text()", namespaces=ns):
            matches = re.findall(r"\[([\d,\s]+)\]", t)
            for m in matches:
                # Split by comma in case of [1, 2]
                nums = [int(n.strip()) for n in m.split(",") if n.strip().isdigit()]
                if nums:
                    max_source = max(max_source, max(nums))

        sources = max_source

    return figures, tables, sources


def pluralize_ru(n, form1, form2, form5):
    n = abs(n) % 100
    n1 = n % 10
    if n > 10 and n < 20:
        return form5
    if n1 > 1 and n1 < 5:
        return form2
    if n1 == 1:
        return form1
    return form5


def normalize_tables(doc):
    changed = 0
    for index in range(1, doc.Tables.Count + 1):
        try:
            doc.Tables(index).Rows(1).HeadingFormat = True
            changed += 1
        except Exception:
            continue
    return changed


def normalize_inline_images(doc):
    centered = 0
    scaled = 0

    for index in range(1, doc.InlineShapes.Count + 1):
        try:
            shape = doc.InlineShapes(index)
            shape.Range.ParagraphFormat.Alignment = WD_ALIGN_PARAGRAPH_CENTER
            centered += 1

            shape.LockAspectRatio = True
            if abs(shape.Width - MAX_IMAGE_WIDTH_POINTS) > 1:
                shape.Width = MAX_IMAGE_WIDTH_POINTS
                scaled += 1
        except Exception:
            continue

    return centered, scaled


def previous_paragraph_before(doc, position):
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


def keep_small_tables_on_one_page(doc):
    moved = 0

    doc.Repaginate()
    for index in range(1, doc.Tables.Count + 1):
        try:
            table = doc.Tables(index)
            if table.Rows.Count > 10:
                continue

            start_page = doc.Range(
                table.Range.Start,
                table.Range.Start,
            ).Information(WD_ACTIVE_END_PAGE_NUMBER)
            end_page = doc.Range(
                max(table.Range.Start, table.Range.End - 1),
                max(table.Range.Start, table.Range.End - 1),
            ).Information(WD_ACTIVE_END_PAGE_NUMBER)
            if start_page == end_page:
                continue

            caption = previous_paragraph_before(doc, table.Range.Start)
            if caption is None:
                continue

            caption_text = caption.Range.Text.strip()
            if not caption_text.startswith("Таблица"):
                continue

            caption.Range.ParagraphFormat.PageBreakBefore = True
            moved += 1
        except Exception:
            continue

    if moved:
        doc.Repaginate()

    return moved


def get_default_pdf_path(docx_path):
    return str(Path(docx_path).with_suffix(".pdf"))


def export_pdf(doc, docx_path, pdf_output_path=None):
    pdf_path = os.path.abspath(pdf_output_path or get_default_pdf_path(docx_path))
    Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)

    if os.path.exists(pdf_path):
        try:
            os.remove(pdf_path)
        except PermissionError as error:
            raise RuntimeError(
                f"PDF export target is locked. Close the PDF and rerun post-build: {pdf_path}"
            ) from error

    doc.ExportAsFixedFormat(pdf_path, WD_EXPORT_FORMAT_PDF)
    return pdf_path


def clear_dirty_fields(docx_path):
    with zipfile.ZipFile(docx_path, "r") as zf:
        names = zf.namelist()
        files = {name: zf.read(name) for name in names}

    document_name = "word/document.xml"
    if document_name not in files:
        return 0

    doc_xml = files[document_name].decode("utf-8")
    cleared = len(DIRTY_TRUE_RE.findall(doc_xml))
    if cleared == 0:
        return 0

    files[document_name] = DIRTY_TRUE_RE.sub('w:dirty="false"', doc_xml).encode("utf-8")

    fd, temp_name = tempfile.mkstemp(suffix=".docx", dir=str(Path(docx_path).parent))
    os.close(fd)
    Path(temp_name).unlink()
    try:
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                zout.writestr(name, files[name])
        shutil.move(temp_name, docx_path)
    except Exception:
        if Path(temp_name).exists():
            Path(temp_name).unlink()
        raise

    return cleared


def post_build(docx_path, report_source_dir=None, pdf_output_path=None):
    abs_path = os.path.abspath(docx_path)
    if not os.path.exists(abs_path):
        print(f"Error: File not found - {abs_path}", file=sys.stderr)
        sys.exit(1)

    candidate_source_dir = Path(report_source_dir) if report_source_dir else Path(abs_path).parent
    source_dir: Path | None = (
        candidate_source_dir if any(candidate_source_dir.glob("*.md")) else None
    )

    formula_replacements = 0
    if source_dir is not None:
        formula_replacements = replace_formulas_from_markdown(abs_path, source_dir)

    table_spacing_changes = normalize_docx_xml_layout(abs_path)

    figures, tables, sources = get_counts_from_docx(abs_path)

    # Text representations
    fig_text = (
        f"{figures} {pluralize_ru(figures, 'рисунок', 'рисунка', 'рисунков')}"
        if figures > 0
        else ""
    )
    tab_text = (
        f"{tables} {pluralize_ru(tables, 'таблица', 'таблицы', 'таблиц')}" if tables > 0 else ""
    )
    src_text = (
        f"{sources} {pluralize_ru(sources, 'источник', 'источника', 'источников')}"
        if sources > 0
        else ""
    )

    word = None
    doc = None
    pdf_path = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = False

        doc = word.Documents.Open(abs_path, ReadOnly=False)

        # 1. Update TOC
        if doc.TablesOfContents.Count > 0:
            doc.TablesOfContents(1).Update()

        normalized_tables = normalize_tables(doc)
        centered_images, scaled_images = normalize_inline_images(doc)
        moved_small_tables = keep_small_tables_on_one_page(doc)

        # 2. Get Page Count
        doc.Repaginate()
        pages = doc.ComputeStatistics(2)  # wdStatisticPages

        # 3. Replace placeholders and VALIDATE
        replacements = {
            "{{PAGES}}": str(pages),
            "{{FIGURES}}": fig_text,
            "{{TABLES}}": tab_text,
            "{{SOURCES}}": src_text,
        }

        errors = []
        for p in doc.Paragraphs:
            text = p.Range.Text
            if "Источник не найден" in text or "NOT FOUND" in text:
                errors.append(f"CRITICAL: Broken reference or source found: {text.strip()}")

        if errors:
            print("\n".join(errors), file=sys.stderr)
            sys.exit(1)

        for placeholder, value in replacements.items():
            rng = doc.Content
            rng.Find.ClearFormatting()
            rng.Find.Replacement.ClearFormatting()
            # Execute(FindText, MatchCase, MatchWholeWord, MatchWildcards, MatchSoundsLike, MatchAllWordForms, Forward, Wrap, Format, ReplaceWith, Replace)
            rng.Find.Execute(
                placeholder, False, False, False, False, False, True, 1, False, value, 2
            )  # wdReplaceAll

        # Clean up empty commas (if any count was 0)
        rng = doc.Content
        rng.Find.ClearFormatting()
        rng.Find.Replacement.ClearFormatting()
        rng.Find.Execute(" ,", False, False, False, False, False, True, 1, False, "", 2)

        rng = doc.Content
        rng.Find.Execute(", ,", False, False, False, False, False, True, 1, False, ",", 2)

        doc.Save()
        pdf_path = export_pdf(doc, abs_path, pdf_output_path)

    except Exception as e:
        print(f"Error during post-build: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if doc is not None:
            with contextlib.suppress(Exception):
                doc.Close(False)  # don't save if error
        if word is not None:
            with contextlib.suppress(Exception):
                word.Quit()

    dirty_fields = clear_dirty_fields(abs_path)
    print(
        f"Post-build complete: {pages} pages, {figures} figures, {tables} tables, {sources} sources; "
        f"table headers: {normalized_tables}, centered images: {centered_images}, "
        f"scaled images: {scaled_images}, formulas replaced: {formula_replacements}, "
        f"table spacing adjusted: {table_spacing_changes}, moved small tables: {moved_small_tables}, "
        f"dirty fields cleared: {dirty_fields}, PDF exported: {pdf_path}."
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Usage: python post_build.py <path_to_docx> [report_source_dir] [pdf_output_path]",
            file=sys.stderr,
        )
        sys.exit(1)

    post_build(
        sys.argv[1],
        sys.argv[2] if len(sys.argv) > 2 else None,
        sys.argv[3] if len(sys.argv) > 3 else None,
    )
