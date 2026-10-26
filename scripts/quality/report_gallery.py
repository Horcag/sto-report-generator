"""Publish every page of the public Word corpus and detect stale documentation."""

# ruff: noqa: RUF001

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path("docs/assets/gallery")
INDEX = Path("docs/gallery.md")
MANIFEST = ASSETS / "manifest.json"
CORPUS = (
    (
        "example",
        "Демонстрационный отчёт",
        "example",
        "Титульный лист, реферат, оглавление, текст, таблица, рисунок, списки и источники.",
    ),
    (
        "formulas",
        "Формулы",
        "tests/fixtures/formulas/layout.md",
        "Дроби, суммы, интегралы, системы, кусочные функции, переносы и номера формул.",
    ),
    (
        "matrices",
        "Матрицы",
        "tests/fixtures/wordcraft/matrix-controls.md",
        "Матрицы разных размеров, скобки, определители и вложенные конструкции.",
    ),
    (
        "fences",
        "Скобки и единичные матрицы",
        "tests/fixtures/formulas/fences.md",
        "Квадратные и круглые скобки, единичные матрицы 2×2–4×4 и вложенные дроби.",
    ),
    (
        "structure",
        "Стили и структурные элементы",
        "tests/fixtures/dotm-word-corpus",
        "Уровни заголовков, оглавление, рисунок, длинная таблица с продолжением и библиография.",
    ),
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def input_digest(path: Path) -> str:
    data = path.read_bytes()
    if path.suffix.lower() in {
        ".ts",
        ".py",
        ".json",
        ".md",
        ".bib",
        ".svg",
        ".ps1",
        ".toml",
        ".lock",
    }:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def inputs(root: Path) -> dict[str, str]:
    """Cover rendering code and public sources, without private reports or outputs."""
    paths = [
        "src",
        "example",
        "scripts/sto_post_build",
        "scripts/post_build.py",
        "scripts/word_acceptance.ps1",
        "scripts/stop_word_acceptance.ps1",
        "scripts/quality/report_gallery.py",
        "scripts/quality/preserve_pdf_images.py",
        "scripts/quality/inspect_pdf_images.py",
        "package.json",
        "package-lock.json",
        "pyproject.toml",
        "uv.lock",
        *(entry[2] for entry in CORPUS),
    ]
    files: set[Path] = set()
    for name in paths:
        path = root / name
        if path.is_dir():
            files.update(
                p
                for p in path.rglob("*")
                if p.is_file()
                and p.suffix
                in {
                    ".ts",
                    ".py",
                    ".json",
                    ".md",
                    ".bib",
                    ".svg",
                    ".png",
                    ".jpg",
                    ".jpeg",
                }
                and "__pycache__" not in p.parts
                and "build" not in p.parts
            )
        else:
            files.add(path)
    return {p.relative_to(root).as_posix(): input_digest(p) for p in sorted(files)}


def gallery(documents: list[dict]) -> str:
    lines = [
        "# Галерея отчётов",
        "",
        "Все страницы публичного демонстрационного и проверочного корпуса, экспортированные Microsoft Word.",
        "Тестовые документы показывают отдельные конструкции; они не заменяют проверку конкретного отчёта.",
        "Имена и библиографические записи в корпусе демонстрационные.",
        "",
        "[Вернуться в README](../README.md) · [Как обновить галерею](gallery-workflow.md)",
        "",
    ]
    for document in documents:
        key = document["id"]
        lines.append(f"- [{document['title']}](#{key}) — страниц: {len(document['pages'])}.")
    for document in documents:
        key = document["id"]
        if lines[-1]:
            lines.append("")
        lines.extend(
            [
                f'<a id="{key}"></a>',
                "",
                f"## {document['title']}",
                "",
                document["description"],
                "",
                f"[Исходник](../{document['source']})",
                "",
            ]
        )
        links = [f"[{i}](#{key}-{i})" for i in range(1, len(document["pages"]) + 1)]
        lines.extend(["Страницы: " + " · ".join(links) + ".", ""])
        for number, page in enumerate(document["pages"], 1):
            lines.extend(
                [
                    f'<a id="{key}-{number}"></a>',
                    "",
                    f"### Страница {number}",
                    "",
                    f"![{document['title']}: страница {number}](assets/gallery/{page['file']})",
                    "",
                ]
            )
    return "\n".join(lines)


def check(root: Path) -> None:
    manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
    if manifest["inputs"] != inputs(root):
        raise ValueError("Gallery inputs changed. Run npm run gallery:update on a Word host.")
    documents = manifest["documents"]
    if [d["id"] for d in documents] != [c[0] for c in CORPUS]:
        raise ValueError("Gallery corpus is incomplete")
    expected = {"manifest.json"}
    for document, (key, title, source, description) in zip(documents, CORPUS, strict=True):
        if any(
            document[field] != value
            for field, value in (
                ("title", title),
                ("source", source),
                ("description", description),
            )
        ):
            raise ValueError(f"Gallery metadata changed: {key}")
        if not document["pages"] or document["pageCount"] != len(document["pages"]):
            raise ValueError(f"Gallery pages are missing: {key}")
        for number, page in enumerate(document["pages"], 1):
            filename = f"{key}-page-{number}.png"
            if page["file"] != filename or digest(root / ASSETS / filename) != page["sha256"]:
                raise ValueError(f"Gallery image changed: {filename}")
            expected.add(filename)
    if {p.name for p in (root / ASSETS).iterdir()} != expected:
        raise ValueError("Unexpected gallery assets; regenerate the gallery")
    if (root / INDEX).read_text(encoding="utf-8") != gallery(documents):
        raise ValueError("Gallery index changed; regenerate the gallery")
    print(f"Gallery is current: {len(documents)} documents, {len(expected) - 1} pages.")


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True, timeout=1000)


def build_source(source: str, key: str, work: Path) -> Path:
    original = ROOT / source
    if key == "structure":
        copied = work / key
        shutil.copytree(original, copied)
        # Match the live regression harness: keep the canonical SVG/PNG pair aligned.
        for asset in ("dummy.svg", "dummy.png"):
            shutil.copyfile(ROOT / "example/images" / asset, copied / "images" / asset)
        body = copied / "03_body.md"
        text = body.read_text(encoding="utf-8")
        marker = "\n\nПосле таблицы"
        if text.count(marker) != 1:
            raise ValueError("Style corpus table insertion marker changed")
        rows = "\n".join(
            f"| {i} | Одинаковое содержание строки для проверки переноса. |" for i in range(31, 91)
        )
        body.write_text(text.replace(marker, "\n" + rows + marker), encoding="utf-8")
        return copied
    if original.is_dir():
        return original
    # Isolated parser fixtures have no title metadata; reuse the public demo header.
    metadata = (ROOT / "example/00_metadata.md").read_text(encoding="utf-8").split("---", 2)[1]
    wrapped = work / f"{key}.md"
    wrapped.write_text(
        "---" + metadata + "---\n\n" + original.read_text(encoding="utf-8"), encoding="utf-8"
    )
    return wrapped


def npm_launcher(node: str, npm: str, *, windows: bool) -> list[str]:
    if not windows:
        return [npm]
    # Avoid implicit cmd.exe interpretation of valid scratch path metacharacters.
    cli = Path(node).parent / "node_modules/npm/bin/npm-cli.js"
    if not cli.is_file():
        raise RuntimeError("Cannot locate npm-cli.js beside Node.js for safe Windows invocation")
    return [node, str(cli)]


def update(scratch: Path | None) -> None:
    import pymupdf  # Only regeneration needs the optional rasterizer.

    before = inputs(ROOT)
    npm = shutil.which("npm")
    node = shutil.which("node")
    if not npm or not node:
        raise RuntimeError("Node.js and npm are required")
    with tempfile.TemporaryDirectory(prefix="sto-gallery-", dir=scratch) as temporary:
        work = Path(temporary)
        stage = work / "images"
        stage.mkdir()
        for key, _title, source, _description in CORPUS:
            run(
                [
                    node,
                    str(ROOT / "node_modules/tsx/dist/cli.mjs"),
                    "src/index.ts",
                    "build",
                    str(build_source(source, key, work)),
                    str(work / f"{key}.docx"),
                ]
            )
        documents = []
        for key, title, source, description in CORPUS:
            print(f"Rendering {key} from {source}", flush=True)
            raw, accepted, pdf, receipt = [
                work / f"{key}.{suffix}"
                for suffix in (
                    "docx",
                    "accepted.docx",
                    "pdf",
                    "json",
                )
            ]
            # The launcher owns its Word deadlines, PID records and verified cleanup.
            run(
                [
                    *npm_launcher(node, npm, windows=os.name == "nt"),
                    "run",
                    "accept:word",
                    "--",
                    str(raw),
                    "--accepted-docx",
                    str(accepted),
                    "--pdf",
                    str(pdf),
                    "--manifest",
                    str(receipt),
                    "--pdf-image-quality",
                    "print",
                ]
            )
            evidence = json.loads(receipt.read_text(encoding="utf-8-sig"))
            if (
                evidence["status"] != "accepted"
                or not evidence["execution"]["processCleanupVerified"]
                or not evidence["stablePageCount"]
            ):
                raise ValueError(f"Word acceptance incomplete: {key}")
            pages = []
            with pymupdf.open(pdf) as rendered:
                if len(rendered) != evidence["pageCountAfterReopen"]:
                    raise ValueError(f"PDF/Word page count mismatch: {key}")
                for number, page in enumerate(rendered, 1):
                    if "undefined" in page.get_text():
                        raise ValueError(f"Unresolved metadata on {key} page {number}")
                    filename = f"{key}-page-{number}.png"
                    page.get_pixmap(dpi=120, alpha=False).save(stage / filename)
                    pages.append({"file": filename, "sha256": digest(stage / filename)})
            documents.append(
                {
                    "id": key,
                    "title": title,
                    "source": source,
                    "description": description,
                    "renderer": evidence["renderer"],
                    "wordVersion": evidence["word"]["version"],
                    "wordBuild": evidence["word"]["build"],
                    "pdfImageQuality": "print",
                    "pdfSha256": digest(pdf),
                    "pageCount": len(pages),
                    "pages": pages,
                }
            )
        after = inputs(ROOT)
        if before != after:
            changed = sorted(
                name for name in before.keys() | after.keys() if before.get(name) != after.get(name)
            )
            raise ValueError(
                "Inputs changed during rendering; gallery was not published: " + ", ".join(changed)
            )
        manifest = {"schemaVersion": 1, "dpi": 120, "inputs": before, "documents": documents}
        (stage / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        destination = ROOT / ASSETS
        destination.mkdir(parents=True, exist_ok=True)
        for old in destination.glob("*-page-*.png"):
            old.unlink()
        for file in stage.iterdir():
            shutil.copyfile(file, destination / file.name)
        (ROOT / INDEX).write_text(gallery(documents), encoding="utf-8")
    check(ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "update"))
    options = parser.parse_args()
    if options.command == "check":
        check(ROOT)
    else:
        scratch = os.environ.get("AGENT_STORAGE_SCRATCH")
        update(Path(scratch) if scratch else None)


if __name__ == "__main__":
    main()
