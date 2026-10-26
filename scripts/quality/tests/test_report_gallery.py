"""Freshness must reject stale inputs, damaged images and incomplete indexes."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality import report_gallery as gallery


class GalleryFreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.assets = self.root / gallery.ASSETS
        self.assets.mkdir(parents=True)
        self.documents: list[dict] = []
        for key, title, source, description in gallery.CORPUS:
            pages = []
            for number in range(1, 3):
                filename = f"{key}-page-{number}.png"
                image = self.assets / filename
                image.write_bytes(b"synthetic raster bytes")
                pages.append({"file": filename, "sha256": gallery.digest(image)})
            self.documents.append(
                {
                    "id": key,
                    "title": title,
                    "source": source,
                    "description": description,
                    "pageCount": 2,
                    "pages": pages,
                }
            )
        self.manifest: dict = {"inputs": {"src/parser.ts": "original"}, "documents": self.documents}
        self.write_manifest()
        (self.root / gallery.INDEX).write_text(gallery.gallery(self.documents), encoding="utf-8")
        patched = patch.object(gallery, "inputs", return_value=self.manifest["inputs"].copy())
        self.inputs = patched.start()
        self.addCleanup(patched.stop)

    def write_manifest(self) -> None:
        (self.root / gallery.MANIFEST).write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_current_gallery_passes(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()) as output:
            gallery.check(self.root)
        self.assertIn("5 documents, 10 pages", output.getvalue())

    def test_generator_change_requires_regeneration(self) -> None:
        self.inputs.return_value = {"src/parser.ts": "changed"}
        with self.assertRaisesRegex(ValueError, "inputs changed"):
            gallery.check(self.root)

    def test_changed_or_missing_image_fails(self) -> None:
        image = self.assets / "example-page-2.png"
        image.write_bytes(b"damaged")
        with self.assertRaisesRegex(ValueError, "image changed"):
            gallery.check(self.root)
        image.unlink()
        with self.assertRaises(FileNotFoundError):
            gallery.check(self.root)

    def test_missing_index_page_fails(self) -> None:
        (self.root / gallery.INDEX).write_text("# incomplete index\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "index changed"):
            gallery.check(self.root)

    def test_unindexed_image_fails(self) -> None:
        (self.assets / "extra-page-1.png").write_bytes(b"unindexed")
        with self.assertRaisesRegex(ValueError, "Unexpected gallery assets"):
            gallery.check(self.root)

    def test_missing_document_fails(self) -> None:
        self.manifest["documents"] = self.documents[:-1]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "corpus is incomplete"):
            gallery.check(self.root)

    def test_truncated_page_list_fails(self) -> None:
        self.documents[0]["pages"].pop()
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "pages are missing"):
            gallery.check(self.root)


class InputHashTests(unittest.TestCase):
    def test_generated_and_hidden_trees_are_not_source_inputs(self) -> None:
        with tempfile.TemporaryDirectory(prefix=".gallery-source-") as temporary:
            root = Path(temporary)
            public = [
                "example/00_metadata.md",
                "example/report.config.json",
                "example/images/dummy.svg",
                "example/images/nested/plot.png",
            ]
            generated = [
                "example/.temp_docx/word/media/random.svg",
                "example/probe_unpacked/word/media/random.png",
                "example/build/output.json",
                "example/__pycache__/temporary.py",
                "example/.private.json",
                "example/output.figures.json",
                "example/output.acceptance.json",
                "example/output.wordcraft.json",
            ]
            for name in public + generated:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic fixture")
            self.assertEqual(
                {p.relative_to(root).as_posix() for p in gallery.source_files(root, ["example"])},
                set(public),
            )

    def test_text_inputs_ignore_checkout_newline_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            for extension in ("ts", "py", "json", "md", "bib", "svg", "ps1", "toml", "lock"):
                with self.subTest(extension=extension):
                    source = Path(temporary) / f"source.{extension}"
                    source.write_bytes(b"first\nsecond\n")
                    expected = gallery.input_digest(source)
                    source.write_bytes(b"first\r\nsecond\r\n")
                    self.assertEqual(gallery.input_digest(source), expected)
                    source.write_bytes(b"changed\r\n")
                    self.assertNotEqual(gallery.input_digest(source), expected)

    def test_binary_input_and_output_hashes_keep_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary) / "image.png"
            image.write_bytes(b"first\nsecond")
            before = gallery.input_digest(image)
            image.write_bytes(b"first\r\nsecond")
            self.assertNotEqual(gallery.input_digest(image), before)
            self.assertEqual(gallery.input_digest(image), gallery.digest(image))


class NpmLauncherTests(unittest.TestCase):
    def test_posix_uses_resolved_npm(self) -> None:
        self.assertEqual(gallery.npm_launcher("/node", "/npm", windows=False), ["/npm"])

    def test_windows_uses_node_and_js_cli_without_batch_interpretation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gallery&") as temporary:
            root = Path(temporary)
            cli = root / "node_modules/npm/bin/npm-cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("// synthetic CLI", encoding="utf-8")
            node = str(root / "node.exe")
            self.assertEqual(
                gallery.npm_launcher(node, str(root / "npm.cmd"), windows=True), [node, str(cli)]
            )
            cli.unlink()
            with self.assertRaisesRegex(RuntimeError, "Cannot locate npm-cli.js"):
                gallery.npm_launcher(node, str(root / "npm.cmd"), windows=True)


class GallerySourceTests(unittest.TestCase):
    def test_style_corpus_extends_table_and_copies_canonical_figure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "corpus"
            (original / "images").mkdir(parents=True)
            (original / "03_body.md").write_text(
                "| 30 | строка |\n\nПосле таблицы текст",  # noqa: RUF001
                encoding="utf-8",
            )
            (root / "example/images").mkdir(parents=True)
            for name in ("dummy.svg", "dummy.png"):
                (root / "example/images" / name).write_bytes(b"canonical")
            work = root / "work"
            work.mkdir()
            with patch.object(gallery, "ROOT", root):
                copied = gallery.build_source("corpus", "structure", work)
            body = (copied / "03_body.md").read_text(encoding="utf-8")
            self.assertIn("| 90 |", body)
            self.assertEqual(body.count("| 31 |"), 1)
            self.assertEqual((copied / "images/dummy.png").read_bytes(), b"canonical")
            self.assertNotIn("| 90 |", (original / "03_body.md").read_text(encoding="utf-8"))

    def test_single_file_keeps_body_and_gets_public_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "example").mkdir()
            (root / "example/00_metadata.md").write_text(
                "---\nstudentName: Demo\n---\n", encoding="utf-8"
            )
            source = root / "formula.md"
            source.write_text("# Formula\n\n$$x^2$$\n", encoding="utf-8")
            work = root / "work"
            work.mkdir()
            with patch.object(gallery, "ROOT", root):
                wrapped = gallery.build_source("formula.md", "formulas", work)
                directory = gallery.build_source("example", "example", work)
            self.assertEqual(directory, root / "example")
            self.assertEqual(
                wrapped.read_text(encoding="utf-8"),
                "---\nstudentName: Demo\n---\n\n" + source.read_text(encoding="utf-8"),
            )
            self.assertEqual(source.read_text(encoding="utf-8"), "# Formula\n\n$$x^2$$\n")


if __name__ == "__main__":
    unittest.main()
