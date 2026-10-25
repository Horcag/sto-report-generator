"""Export PDF with Word's explicit original image quality option."""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .constants import WD_EXPORT_FORMAT_PDF


def get_default_pdf_path(docx_path: str | Path) -> str:
    return str(Path(docx_path).with_suffix(".pdf"))


def helper_diagnostic(error: subprocess.CalledProcessError | subprocess.TimeoutExpired) -> str:
    output = error.stderr or error.stdout or "No helper diagnostic output."
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace").strip()
    return str(output).strip()


def preserve_original_pdf_images(docx_path: str | Path, pdf_path: str) -> None:
    repository = Path(__file__).resolve().parents[2]
    helper = repository / "scripts" / "quality" / "preserve_pdf_images.py"
    # Keep both staged files on the destination filesystem for atomic replacement.
    with tempfile.TemporaryDirectory(prefix=".pdf-images-", dir=Path(pdf_path).parent) as directory:
        restored = Path(directory) / "original.pdf"
        receipt = Path(directory) / "images.json"
        try:
            subprocess.run(
                [
                    "uv",
                    "run",
                    "--with",
                    "pymupdf==2.0",
                    "python",
                    str(helper),
                    str(Path(docx_path).resolve()),
                    pdf_path,
                    "--output",
                    str(restored),
                    "--receipt",
                    str(receipt),
                ],
                cwd=repository,
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except subprocess.CalledProcessError as error:
            raise RuntimeError(
                f"PDF original image restoration failed (exit {error.returncode}): "
                f"{helper_diagnostic(error)}"
            ) from error
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"PDF original image restoration timed out after {error.timeout} seconds: "
                f"{helper_diagnostic(error)}"
            ) from error
        evidence = json.loads(receipt.read_text(encoding="utf-8"))
        if evidence.get("status") != "originalPixelsVerified":
            raise RuntimeError("PDF image restoration did not verify original pixels")
        os.replace(restored, pdf_path)
        os.replace(receipt, f"{pdf_path}.images.json")


def export_pdf(doc: Any, docx_path: str | Path, pdf_output_path: str | Path | None = None) -> str:
    try:
        export = doc.ExportAsFixedFormat2
    except AttributeError as error:
        raise RuntimeError(
            "Original PDF image quality requires Word Document.ExportAsFixedFormat2. "
            "Use a supported Word version or explicitly choose print quality with "
            "npm run accept:word -- <docx> --pdf-image-quality print."
        ) from error

    pdf_path = os.path.abspath(str(pdf_output_path or get_default_pdf_path(docx_path)))
    Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)

    if os.path.exists(pdf_path):
        try:
            os.remove(pdf_path)
        except PermissionError as error:
            raise RuntimeError(
                f"PDF export target is locked. Close the PDF and rerun post-build: {pdf_path}"
            ) from error

    # https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat2
    export(
        OutputFileName=pdf_path,
        ExportFormat=WD_EXPORT_FORMAT_PDF,
        OptimizeFor=0,  # wdExportOptimizeForPrint
        OptimizeForImageQuality=True,
    )
    preserve_original_pdf_images(docx_path, pdf_path)
    return pdf_path
