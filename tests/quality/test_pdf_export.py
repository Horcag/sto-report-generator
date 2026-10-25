import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.sto_post_build.word_automation import export_pdf


class PdfExportTests(unittest.TestCase):
    def setUp(self):
        self.process = self.enterContext(
            patch("scripts.sto_post_build.pdf_export.subprocess.run", side_effect=self.restore)
        )

    @staticmethod
    def restore(command, **_kwargs):
        Path(command[command.index("--output") + 1]).write_bytes(b"verified PDF")
        Path(command[command.index("--receipt") + 1]).write_text(
            json.dumps({"status": "originalPixelsVerified"}), encoding="utf-8"
        )
        return subprocess.CompletedProcess(command, 0)

    def test_default_export_keeps_original_image_quality(self):
        with tempfile.TemporaryDirectory() as directory:
            docx = Path(directory) / "report.docx"
            expected_pdf = str(docx.with_suffix(".pdf"))
            doc = SimpleNamespace(ExportAsFixedFormat2=Mock(), ExportAsFixedFormat=Mock())

            self.assertEqual(export_pdf(doc, docx), expected_pdf)

            doc.ExportAsFixedFormat2.assert_called_once_with(
                OutputFileName=expected_pdf,
                ExportFormat=17,
                OptimizeFor=0,
                OptimizeForImageQuality=True,
            )
            doc.ExportAsFixedFormat.assert_not_called()
            self.assertEqual(Path(expected_pdf).read_bytes(), b"verified PDF")
            self.assertEqual(
                json.loads(Path(f"{expected_pdf}.images.json").read_text())["status"],
                "originalPixelsVerified",
            )
            command = self.process.call_args.args[0]
            self.assertEqual(command[:5], ["uv", "run", "--with", "pymupdf==2.0", "python"])
            self.assertTrue(Path(command[5]).is_absolute())
            self.assertEqual(Path(command[5]).name, "preserve_pdf_images.py")
            self.assertEqual(command[6:8], [str(docx.resolve()), expected_pdf])
            self.assertEqual(self.process.call_args.kwargs["timeout"], 120)
            self.assertFalse(self.process.call_args.kwargs["shell"])
            self.assertTrue(self.process.call_args.kwargs["check"])
            self.assertEqual(list(Path(directory).glob(".pdf-images-*")), [])

    def test_missing_api_reports_explicit_print_option_and_preserves_existing_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            docx = Path(directory) / "report.docx"
            pdf = docx.with_suffix(".pdf")
            pdf.write_bytes(b"existing PDF")
            doc = SimpleNamespace(ExportAsFixedFormat=Mock())

            with self.assertRaisesRegex(
                RuntimeError, "supported Word.*npm run accept:word.*--pdf-image-quality print"
            ):
                export_pdf(doc, docx)

            self.assertEqual(pdf.read_bytes(), b"existing PDF")
            doc.ExportAsFixedFormat.assert_not_called()
            self.process.assert_not_called()

    def test_export_failure_propagates_without_retry_or_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            error = RuntimeError("Word export failed")
            doc = SimpleNamespace(
                ExportAsFixedFormat2=Mock(side_effect=error), ExportAsFixedFormat=Mock()
            )

            with self.assertRaises(RuntimeError) as caught:
                export_pdf(doc, Path(directory) / "report.docx")

            self.assertIs(caught.exception, error)
            doc.ExportAsFixedFormat2.assert_called_once()
            doc.ExportAsFixedFormat.assert_not_called()
            self.process.assert_not_called()

    def test_explicit_target_creates_parent_and_replaces_old_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "nested" / "target.pdf"
            doc = SimpleNamespace(ExportAsFixedFormat2=Mock())
            export_pdf(doc, Path(directory) / "report.docx", pdf)
            self.assertTrue(pdf.parent.is_dir())
            pdf.write_bytes(b"old PDF")

            self.assertEqual(export_pdf(doc, "report.docx", pdf), str(pdf))

            self.assertEqual(pdf.read_bytes(), b"verified PDF")
            self.assertEqual(doc.ExportAsFixedFormat2.call_count, 2)

    def test_locked_target_preserves_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "report.pdf"
            pdf.write_bytes(b"existing PDF")
            doc = SimpleNamespace(ExportAsFixedFormat2=Mock())

            with (
                patch("scripts.sto_post_build.pdf_export.os.remove", side_effect=PermissionError),
                self.assertRaisesRegex(RuntimeError, "PDF export target is locked"),
            ):
                export_pdf(doc, "report.docx", pdf)

            doc.ExportAsFixedFormat2.assert_not_called()
            self.assertEqual(pdf.read_bytes(), b"existing PDF")
            self.process.assert_not_called()

    def test_helper_failure_or_timeout_does_not_replace_pdf_and_cleans_staging(self):
        for error, message in [
            (
                subprocess.CalledProcessError(1, ["uv"], stderr="identity uncertain"),
                "failed.*exit 1.*identity uncertain",
            ),
            (
                subprocess.CalledProcessError(1, ["uv"], output="use print/screen quality"),
                "failed.*use print/screen quality",
            ),
            (
                subprocess.TimeoutExpired(["uv"], timeout=120, stderr=b"partial helper progress"),
                "timed out after 120 seconds.*partial helper progress",
            ),
            (
                subprocess.TimeoutExpired(["uv"], timeout=120),
                "timed out after 120 seconds.*No helper diagnostic output",
            ),
        ]:
            with (
                self.subTest(error=type(error).__name__),
                tempfile.TemporaryDirectory() as directory,
            ):
                docx = Path(directory) / "report.docx"
                pdf = docx.with_suffix(".pdf")
                self.process.reset_mock()
                self.process.side_effect = error
                doc = SimpleNamespace(
                    ExportAsFixedFormat2=Mock(
                        side_effect=lambda **kwargs: Path(kwargs["OutputFileName"]).write_bytes(
                            b"Word export before verification"
                        )
                    )
                )

                with self.assertRaisesRegex(RuntimeError, message) as caught:
                    export_pdf(doc, docx)

                self.assertIs(caught.exception.__cause__, error)
                self.process.assert_called_once()
                self.assertEqual(pdf.read_bytes(), b"Word export before verification")
                self.assertFalse(Path(f"{pdf}.images.json").exists())
                self.assertEqual(list(Path(directory).glob(".pdf-images-*")), [])

    def test_unverified_receipt_does_not_replace_pdf(self):
        def unverified(command, **kwargs):
            self.restore(command, **kwargs)
            Path(command[command.index("--receipt") + 1]).write_text('{"status":"failed"}')

        with tempfile.TemporaryDirectory() as directory:
            docx = Path(directory) / "report.docx"
            pdf = docx.with_suffix(".pdf")
            self.process.side_effect = unverified
            doc = SimpleNamespace(
                ExportAsFixedFormat2=Mock(
                    side_effect=lambda **kwargs: Path(kwargs["OutputFileName"]).write_bytes(
                        b"Word export before verification"
                    )
                )
            )

            with self.assertRaisesRegex(RuntimeError, "did not verify original pixels"):
                export_pdf(doc, docx)

            self.assertEqual(pdf.read_bytes(), b"Word export before verification")
            self.assertFalse(Path(f"{pdf}.images.json").exists())
            self.assertEqual(list(Path(directory).glob(".pdf-images-*")), [])


if __name__ == "__main__":
    unittest.main()
