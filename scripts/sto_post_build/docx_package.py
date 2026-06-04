import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from .constants import DIRTY_TRUE_RE


def read_docx_part(docx_path: str | Path, part_name: str) -> bytes:
    with zipfile.ZipFile(docx_path, "r") as archive:
        return archive.read(part_name)


def rewrite_docx_part(docx_path: str | Path, part_name: str, part_bytes: bytes) -> None:
    with zipfile.ZipFile(docx_path, "r") as archive:
        names = archive.namelist()
        files = {name: archive.read(name) for name in names}

    files[part_name] = part_bytes
    fd, temp_name = tempfile.mkstemp(suffix=".docx", dir=str(Path(docx_path).parent))
    os.close(fd)
    Path(temp_name).unlink()
    try:
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as output_archive:
            for name in names:
                output_archive.writestr(name, files[name])
        shutil.move(temp_name, docx_path)
    except Exception:
        if Path(temp_name).exists():
            Path(temp_name).unlink()
        raise


def clear_dirty_fields(docx_path: str | Path) -> int:
    with zipfile.ZipFile(docx_path, "r") as archive:
        names = archive.namelist()
        files = {name: archive.read(name) for name in names}

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
        with zipfile.ZipFile(temp_name, "w", zipfile.ZIP_DEFLATED) as output_archive:
            for name in names:
                output_archive.writestr(name, files[name])
        shutil.move(temp_name, docx_path)
    except Exception:
        if Path(temp_name).exists():
            Path(temp_name).unlink()
        raise

    return cleared
