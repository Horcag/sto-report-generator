import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from lxml import etree
from scripts.sto_post_build.strict_sto import NS, ORDER, W, normalize_strict_sto_docx

MARKER = """<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="STOStylePreset"><vt:lpwstr>sto-strict</vt:lpwstr></property></Properties>"""
DOCUMENT = """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000" w:themeColor="accent1"/><w:sz w:val="40"/></w:rPr><w:t>Heading</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Code"/><w:ind w:left="300" w:hanging="20"/></w:pPr><w:r><w:t>code</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="TableCaption"/></w:pPr><w:r><w:t>Table</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Formula"/><w:spacing w:line="240"/></w:pPr><m:oMath><m:r><w:rPr><w:b/><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>x</m:t></m:r></m:oMath></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:line="1" w:lineRule="exact"/></w:pPr></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing/></w:r></w:p>
</w:body></w:document>"""
STYLES = """<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Heading1"><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="Code"><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr></w:style></w:styles>"""


class StrictStoTests(unittest.TestCase):
    def create_package(self, directory, strict=True):
        target = Path(directory) / "strict.docx"
        with ZipFile(target, "w") as archive:
            archive.writestr("word/document.xml", DOCUMENT)
            archive.writestr("word/styles.xml", STYLES)
            archive.writestr(
                "word/numbering.xml",
                f'<w:numbering xmlns:w="{NS["w"]}"><w:abstractNum><w:lvl><w:rPr><w:b/></w:rPr></w:lvl></w:abstractNum></w:numbering>',
            )
            archive.writestr(
                "word/footer1.xml",
                f'<w:ftr xmlns:w="{NS["w"]}"><w:p><w:r><w:t>1</w:t></w:r></w:p></w:ftr>',
            )
            archive.writestr("word/media/image.png", b"image-bytes")
            if strict:
                archive.writestr("docProps/custom.xml", MARKER)
        return target

    def test_normalization_preserves_math_images_and_layout_exceptions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            before = etree.fromstring(DOCUMENT.encode())
            math = etree.tostring(before.find(".//m:oMath", NS))
            self.assertEqual(normalize_strict_sto_docx(target), 4)
            with ZipFile(target) as archive:
                root = etree.fromstring(archive.read("word/document.xml"))
                self.assertEqual(etree.tostring(root.find(".//m:oMath", NS)), math)
                self.assertEqual(archive.read("word/media/image.png"), b"image-bytes")
                self.assertEqual(root.find(".//w:drawing/..", NS).find(W + "rPr"), None)
                heading, code, caption, formula, cell, closing, _ = root.findall(".//w:p", NS)
                self.assertEqual(heading.find("w:pPr/w:jc", NS).get(W + "val"), "center")
                for paragraph in (heading, code, cell):
                    self.assertEqual(paragraph.find("w:pPr/w:spacing", NS).get(W + "line"), "360")
                    properties = paragraph.find("w:r/w:rPr", NS)
                    self.assertEqual(properties.find(W + "b").get(W + "val"), "0")
                    self.assertEqual(properties.find(W + "bCs").get(W + "val"), "0")
                    self.assertEqual(properties.find(W + "sz").get(W + "val"), "28")
                    self.assertEqual(
                        dict(properties.find(W + "color").attrib), {W + "val": "000000"}
                    )
                    self.assertEqual(
                        properties.find(W + "rFonts").get(W + "ascii"), "Times New Roman"
                    )
                self.assertEqual(code.find("w:pPr/w:ind", NS).get(W + "firstLine"), "709")
                self.assertEqual(code.find("w:pPr/w:ind", NS).get(W + "left"), "0")
                self.assertEqual(code.find("w:pPr/w:jc", NS).get(W + "val"), "both")
                self.assertEqual(caption.find("w:pPr/w:spacing", NS).get(W + "line"), "240")
                self.assertEqual(formula.find("w:pPr/w:spacing", NS).get(W + "line"), "240")
                self.assertEqual(closing.find("w:pPr/w:spacing", NS).get(W + "line"), "1")
                for part in ("word/styles.xml", "word/numbering.xml", "word/footer1.xml"):
                    xml = etree.fromstring(archive.read(part))
                    self.assertTrue(xml.findall(".//w:rPr/w:b", NS))
                    self.assertTrue(
                        all(node.get(W + "val") == "0" for node in xml.findall(".//w:rPr/w:b", NS))
                    )
            first = target.read_bytes()
            self.assertEqual(normalize_strict_sto_docx(target), 0)
            self.assertEqual(target.read_bytes(), first)

    def test_schema_order_for_new_properties_defaults_and_styles(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            styles = f'<w:styles xmlns:w="{NS["w"]}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:i/><w:u w:val="single"/><w:rPrChange/></w:rPr></w:style></w:styles>'
            with ZipFile(target) as archive:
                parts = {name: archive.read(name) for name in archive.namelist()}
            parts["word/styles.xml"] = styles.encode()
            parts["word/document.xml"] = DOCUMENT.replace(
                '<w:jc w:val="center"/>',
                '<w:jc w:val="center"/><w:sectPr/><w:pPrChange/>',
            ).encode()
            with ZipFile(target, "w") as archive:
                for name, data in parts.items():
                    archive.writestr(name, data)
            normalize_strict_sto_docx(target)
            with ZipFile(target) as archive:
                for name in ("word/document.xml", "word/styles.xml", "word/numbering.xml"):
                    root = etree.fromstring(archive.read(name))
                    for parent in root.iter():
                        if any(
                            etree.QName(ancestor).namespace == NS["m"]
                            for ancestor in parent.iterancestors()
                        ):
                            continue
                        order = ORDER.get(etree.QName(parent).localname)
                        if order is None:
                            continue
                        positions = [
                            order.index(etree.QName(child).localname)
                            for child in parent
                            if etree.QName(child).localname in order
                        ]
                        self.assertEqual(positions, sorted(positions), etree.tostring(parent))
                root = etree.fromstring(archive.read("word/styles.xml"))
                self.assertEqual(
                    [etree.QName(child).localname for child in root], ["docDefaults", "style"]
                )
                self.assertEqual(
                    [etree.QName(child).localname for child in root.find(W + "style")],
                    ["name", "pPr", "rPr"],
                )

    def test_spacing_parity_for_math_styles_pure_math_and_renamed_caption(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            paragraphs = []
            expected = ["120", "120", "120", "360", "240", "240", "120", "120", "240", "240", "360"]
            for style_id in (
                "Formula",
                "MTDisplayEquation",
                "Normal",
                "Normal",
                "TableCaption",
                "RenamedCaption",
                "EqName",
                "DerivedEquation",
                "DerivedCaption",
                "DerivedTemplateCaption",
                "CycleA",
            ):
                pure_math = len(paragraphs) == 2
                content = (
                    "<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath><w:r><w:t> </w:t></w:r>"
                    if pure_math
                    else "<w:r><w:t>Text</w:t></w:r>"
                )
                paragraphs.append(
                    f'<w:p><w:pPr><w:pStyle w:val="{style_id}"/><w:spacing w:line="120" w:lineRule="exact"/></w:pPr>{content}</w:p>'
                )
            document = f'<w:document xmlns:w="{NS["w"]}" xmlns:m="{NS["m"]}"><w:body>{"".join(paragraphs)}</w:body></w:document>'
            styles = STYLES.replace(
                "</w:styles>",
                """<w:style w:type="paragraph" w:styleId="RenamedCaption"><w:name w:val="Table Caption"/></w:style>
<w:style w:type="paragraph" w:styleId="EqName"><w:name w:val="Display Equation"/><w:pPr><w:spacing w:line="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="DerivedEquation"><w:basedOn w:val="EqName"/><w:pPr><w:spacing w:line="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="DerivedCaption"><w:basedOn w:val="RenamedCaption"/></w:style>
<w:style w:type="paragraph" w:styleId="TemplateCaption"><w:name w:val="+№ - Название таблицы"/></w:style>
<w:style w:type="paragraph" w:styleId="DerivedTemplateCaption"><w:basedOn w:val="TemplateCaption"/></w:style>
<w:style w:type="paragraph" w:styleId="CycleA"><w:basedOn w:val="CycleB"/></w:style>
<w:style w:type="paragraph" w:styleId="CycleB"><w:basedOn w:val="CycleA"/></w:style></w:styles>""",
            )
            with ZipFile(target) as archive:
                parts = {name: archive.read(name) for name in archive.namelist()}
            parts.update(
                {
                    "word/document.xml": document.encode(),
                    "word/styles.xml": styles.encode(),
                    "word/charts/custom.xml": b"unrelated malformed XML",
                }
            )
            with ZipFile(target, "w") as archive:
                for name, data in parts.items():
                    archive.writestr(name, data)
            normalize_strict_sto_docx(target)
            with ZipFile(target) as archive:
                root = etree.fromstring(archive.read("word/document.xml"))
                for paragraph, line in zip(root.findall(".//w:p", NS), expected, strict=True):
                    self.assertEqual(paragraph.find("w:pPr/w:spacing", NS).get(W + "line"), line)
                self.assertEqual(archive.read("word/charts/custom.xml"), b"unrelated malformed XML")

    def test_native_normalizer_journals_python_ownership(self):
        script = Path("scripts/word_acceptance.ps1").read_text(encoding="utf-8")
        helper = script[
            script.index("function Invoke-StrictStoNormalization") : script.index(
                "function Get-StyleChecks"
            )
        ]
        self.assertLess(
            helper.index("$env:STO_WORD_OWNERSHIP_DIR = $ownershipDirectory"),
            helper.index("Start-Process"),
        )
        self.assertIn("finally", helper)
        self.assertIn("$env:STO_WORD_OWNERSHIP_DIR = $previousOwnership", helper)
        standalone = Path("scripts/sto_post_build/strict_sto.py").read_text(encoding="utf-8")
        self.assertLess(
            standalone.index('record_process(os.getpid(), "post-build-python")'),
            standalone.index("normalize(sys.argv[1])"),
        )

    def test_standalone_normalizer_entrypoint(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            result = subprocess.run(
                [sys.executable, "scripts/sto_post_build/strict_sto.py", str(target)],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(normalize_strict_sto_docx(target), 0)

    def test_textbox_text_does_not_change_image_host_paragraph(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            with ZipFile(target, "a") as archive:
                document = DOCUMENT.replace(
                    "<w:drawing/>",
                    "<w:drawing><w:txbxContent><w:p><w:r><w:t>Textbox</w:t></w:r></w:p></w:txbxContent></w:drawing>",
                )
                # Rebuild to avoid duplicate ZIP entries in the fixture.
                parts = {name: archive.read(name) for name in archive.namelist()}
            parts["word/document.xml"] = document.encode()
            with ZipFile(target, "w") as archive:
                for name, data in parts.items():
                    archive.writestr(name, data)
            normalize_strict_sto_docx(target)
            with ZipFile(target) as archive:
                root = etree.fromstring(archive.read("word/document.xml"))
                host = root.find("w:body", NS).findall(W + "p")[-1]
                self.assertIsNone(host.find(W + "pPr"))
                textbox = host.find(".//w:txbxContent/w:p", NS)
                self.assertEqual(textbox.find("w:pPr/w:spacing", NS).get(W + "line"), "360")
                self.assertEqual(textbox.find("w:r/w:rPr/w:sz", NS).get(W + "val"), "28")

    def test_unmarked_package_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory, strict=False)
            before = target.read_bytes()
            self.assertEqual(normalize_strict_sto_docx(target), 0)
            self.assertEqual(target.read_bytes(), before)

    def test_final_strict_normalization_precedes_readonly_pdf_export(self):
        from scripts.sto_post_build import orchestrator
        from scripts.sto_post_build.models import DocumentCounts, WordPostBuildResult

        with tempfile.TemporaryDirectory() as directory:
            target = self.create_package(directory)
            events = []
            from contextlib import ExitStack

            with ExitStack() as stack:
                for name, value in {
                    "normalize_docx_xml_layout": 0,
                    "get_counts_from_docx": DocumentCounts(0, 0, 0),
                    "run_word_post_build": WordPostBuildResult(1, 0, 0, 0, 0, "test.pdf"),
                    "normalize_front_matter_table_geometry": 0,
                    "clear_dirty_fields": 0,
                    "count_pdf_pages": 1,
                    "has_legacy_page_count": False,
                    "assert_no_statistic_placeholders": None,
                }.items():
                    stack.enter_context(patch.object(orchestrator, name, return_value=value))
                stack.enter_context(
                    patch.object(
                        orchestrator,
                        "normalize_strict_sto_docx",
                        side_effect=lambda _: events.append("normalize") or 1,
                    )
                )
                stack.enter_context(
                    patch.object(
                        orchestrator,
                        "export_docx_to_pdf",
                        side_effect=lambda *_: events.append("export") or "test.pdf",
                    )
                )
                orchestrator.post_build(target)
                self.assertEqual(events, ["normalize", "normalize", "export"])
                with (
                    patch.object(orchestrator, "count_pdf_pages", side_effect=[1, 2]),
                    self.assertRaisesRegex(
                        RuntimeError, "Strict STO normalization changed pagination"
                    ),
                ):
                    orchestrator.post_build(target)

    def test_native_acceptance_normalizes_after_save_and_before_export(self):
        script = Path("scripts/word_acceptance.ps1").read_text(encoding="utf-8")
        close = script.index(
            "$document.Close($WdDoNotSaveChanges)", script.index("$document.Save()")
        )
        normalize = script.index(
            "Invoke-StrictStoNormalization $request $stagedAcceptedDocx", close
        )
        reopen = script.index("$word.Documents.Open($stagedAcceptedDocx", normalize)
        export = script.index("[WordAcceptance.PdfExporter]::Export", reopen)
        self.assertLess(close, normalize)
        self.assertLess(normalize, reopen)
        self.assertLess(reopen, export)


if __name__ == "__main__":
    unittest.main()
