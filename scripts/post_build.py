import sys
import os
import zipfile
import tempfile
from pathlib import Path
from lxml import etree
import win32com.client

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
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        
        for p in root.xpath('.//w:p', namespaces=ns):
            pStyle = p.xpath('.//w:pStyle/@w:val', namespaces=ns)
            if pStyle:
                style = pStyle[0]
                if style == 'FigureCaption':
                    figures += 1
                elif style == 'TableCaption':
                    tables += 1

            # Count sources by checking numbering reference 'bib-numbering'
            # docx-js generates a specific numId for bib-numbering. 
            # Alternatively, we can just look for text that starts with numbers in the bibliography section, 
            # but since docx-js uses abstractNumId for bib-numbering, we might not easily map it without reading numbering.xml.
            # Let's check numbering.xml to find the numId for bib-numbering.
        
        num_path = Path(temp_dir) / "word" / "numbering.xml"
        bib_num_id = None
        if num_path.exists():
            num_tree = etree.parse(str(num_path))
            num_root = num_tree.getroot()
            # Find abstractNum where w:abstractNumId is used for bib-numbering.
            # docx-js stores the reference string in a custom way or we can just count all items that use the specific numbering level 
            # with the hanging indent 1069/360.
            # Actually, the simplest way to count sources is to count the <w:numId> references that match the bibliography.
            # Since we know docx-js uses a specific numId or we can just count paragraphs inside the bibliography environment.
            # Wait! In parser.ts we handled the bibliography by matching `context.isBib`. 
            pass

        # Since counting sources via XML might be tricky if we don't know the exact numId,
        # let's just count paragraphs that have `w:numPr` and belong to the bibliography part, OR
        # just count references to [X] in the text to find the max citation number?
        # Actually, in parser.ts: `numbering: { reference: 'bib-numbering', level: 0 }`
        # In numbering.xml, docx-js creates an abstractNum and a num instance. 
        # A simpler way to count sources: regex over all text for `\[(\d+)\]` and find the max, OR
        # parse the bibliography text.
        
        # Let's count citations in text: [1], [2], [1, 2], etc.
        max_source = 0
        import re
        for t in root.xpath('.//w:t/text()', namespaces=ns):
            matches = re.findall(r'\[([\d,\s]+)\]', t)
            for m in matches:
                # Split by comma in case of [1, 2]
                nums = [int(n.strip()) for n in m.split(',') if n.strip().isdigit()]
                if nums:
                    max_source = max(max_source, max(nums))
        
        sources = max_source

    return figures, tables, sources

def pluralize_ru(n, form1, form2, form5):
    n = abs(n) % 100
    n1 = n % 10
    if n > 10 and n < 20: return form5
    if n1 > 1 and n1 < 5: return form2
    if n1 == 1: return form1
    return form5

def post_build(docx_path):
    abs_path = os.path.abspath(docx_path)
    if not os.path.exists(abs_path):
        print(f"Error: File not found - {abs_path}", file=sys.stderr)
        sys.exit(1)

    figures, tables, sources = get_counts_from_docx(abs_path)
    
    # Text representations
    fig_text = f"{figures} {pluralize_ru(figures, 'рисунок', 'рисунка', 'рисунков')}" if figures > 0 else ""
    tab_text = f"{tables} {pluralize_ru(tables, 'таблица', 'таблицы', 'таблиц')}" if tables > 0 else ""
    src_text = f"{sources} {pluralize_ru(sources, 'источник', 'источника', 'источников')}" if sources > 0 else ""

    word = None
    doc = None
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        word.DisplayAlerts = False
        
        doc = word.Documents.Open(abs_path, ReadOnly=False)
        
        # 1. Update TOC
        if doc.TablesOfContents.Count > 0:
            doc.TablesOfContents(1).Update()
            
        # 2. Get Page Count
        doc.Repaginate()
        pages = doc.ComputeStatistics(2) # wdStatisticPages
        
        # 3. Replace placeholders and VALIDATE
        replacements = {
            "{{PAGES}}": str(pages),
            "{{FIGURES}}": fig_text,
            "{{TABLES}}": tab_text,
            "{{SOURCES}}": src_text
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
            rng.Find.Execute(placeholder, False, False, False, False, False, True, 1, False, value, 2) # wdReplaceAll
            
        # Clean up empty commas (if any count was 0)
        rng = doc.Content
        rng.Find.ClearFormatting()
        rng.Find.Replacement.ClearFormatting()
        rng.Find.Execute(" ,", False, False, False, False, False, True, 1, False, "", 2)
        
        rng = doc.Content
        rng.Find.Execute(", ,", False, False, False, False, False, True, 1, False, ",", 2)
        
        doc.Save()
        print(f"Post-build complete: {pages} pages, {figures} figures, {tables} tables, {sources} sources.")
        
    except Exception as e:
        print(f"Error during post-build: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if doc is not None:
            doc.Close(False) # don't save if error
        if word is not None:
            word.Quit()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python post_build.py <path_to_docx>", file=sys.stderr)
        sys.exit(1)
    
    post_build(sys.argv[1])
