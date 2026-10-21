import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.quality.compare_renderer_pdfs import (
    compare_documents,
    compare_pdfs,
    compare_rasters,
    compare_text,
    find_anchors,
    inspect_pdf,
    inspect_visuals,
    main,
    normalize_text,
    observed_parity,
    resource_summary,
    sha256,
)

MODULE = "scripts.quality.compare_renderer_pdfs"


def document(texts: list[str]) -> dict:
    return {
        "pageCount": len(texts),
        "pages": [
            {
                "text": text,
                "widthPoints": 595,
                "heightPoints": 842,
                "rotationDegrees": 0,
                "fonts": ["/TimesNewRoman"],
                "imageResourceCount": 1,
            }
            for text in texts
        ],
    }


class Object(dict):
    def get_object(self):
        return self


class RendererComparisonTests(unittest.TestCase):
    def test_text_normalization_and_exact_change(self):
        self.assertEqual(normalize_text("\uff21\n  b\t"), "A b")
        self.assertTrue(compare_text("a\n b", "a b")["equal"])
        changed = compare_text("abc", "adc")
        self.assertFalse(changed["equal"])
        self.assertEqual(changed["differences"][0]["baselineRange"], [1, 2])
        self.assertEqual(changed["differences"][0]["candidate"], "d")
        self.assertEqual(compare_text("", "")["similarity"], 1)

    def test_diff_details_are_bounded(self):
        diff = compare_text("x" * 500, "y" * 500)
        self.assertEqual(len(diff["differences"][0]["baseline"]), 200)
        self.assertEqual(diff["baselineCharacters"], 500)

    def test_page_count_mismatch_retains_unmatched_pages(self):
        pages = compare_documents(document(["one", "two"]), document(["one"]))
        self.assertEqual(pages[1], {"page": 2, "matched": False, "unmatchedSide": "baseline"})
        self.assertFalse(observed_parity(pages, True, []))
        self.assertEqual(
            compare_documents(document([]), document(["x"]))[0]["unmatchedSide"], "candidate"
        )

    def test_text_equality_alone_is_not_parity(self):
        pages = compare_documents(document(["same"]), document(["same"]))
        self.assertFalse(observed_parity(pages, False, []))
        self.assertFalse(observed_parity(pages, True, []))
        pages[0]["raster"] = {"changedFraction": 0}
        self.assertTrue(observed_parity(pages, True, []))
        self.assertFalse(observed_parity(pages, True, ["missing"]))
        match = [{"characterRange": [0, 4], "boundsPoints": [[0, 0, 4, 1]]}]
        pages[0].update(baselineAnchors={"same": match}, candidateAnchors={"same": match})
        self.assertTrue(observed_parity(pages, True, ["same"]))
        pages[0]["candidateAnchors"] = {"same": []}
        self.assertFalse(observed_parity(pages, True, ["same"]))

    def test_resources_recurse_without_double_counting_or_cycles(self):
        image = Object({"/Subtype": "/Image"})
        resources = Object({"/Font": Object({"/F1": Object({"/BaseFont": "/FontA"})})})
        form = Object({"/Subtype": "/Form", "/Resources": resources})
        resources["/XObject"] = Object({"/Image": image, "/Duplicate": image, "/Form": form})
        self.assertEqual(
            resource_summary({"/Resources": resources}),
            {"fonts": ["/FontA"], "imageResourceCount": 1},
        )

    def test_raster_threshold_counts_maximum_rgb_channel(self):
        class Channel:
            def __init__(self, values):
                self.values = values

            def histogram(self):
                return [self.values.count(i) for i in range(256)]

        chops = SimpleNamespace(
            difference=lambda a, b: SimpleNamespace(
                split=lambda: [Channel([0, 16]), Channel([0, 17]), Channel([0, 0])]
            ),
            lighter=lambda a, b: Channel(
                [max(x, y) for x, y in zip(a.values, b.values, strict=True)]
            ),
        )
        image = SimpleNamespace(size=(2, 1), width=2, height=1)
        result = compare_rasters(image, image, chops)
        self.assertEqual(result["changedPixels"], 1)
        self.assertEqual(result["changedFraction"], 0.5)
        self.assertIsNone(
            compare_rasters(image, SimpleNamespace(size=(3, 1)), chops)["changedFraction"]
        )

    def test_anchor_rectangles_and_handles_closed(self):
        from unittest.mock import Mock

        search = Mock()
        search.get_next.side_effect = [(5, 3), None]
        text = Mock()
        text.search.return_value = search
        text.count_rects.return_value = 1
        text.get_rect.return_value = (1, 2, 3, 4)
        result = find_anchors(SimpleNamespace(get_textpage=lambda: text), ["abc"])
        self.assertEqual(result["abc"][0]["characterRange"], [5, 8])
        self.assertEqual(result["abc"][0]["boundsPoints"], [[1, 2, 3, 4]])
        search.close.assert_called_once()
        text.close.assert_called_once()

    def test_hash_and_missing_optional_visual_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.pdf"
            path.write_bytes(b"fixture")
            self.assertEqual(sha256(path), hashlib.sha256(b"fixture").hexdigest())
        with (
            patch(MODULE + ".inspect_pdf", side_effect=[document(["same"]), document(["same"])]),
            patch(
                MODULE + ".importlib.import_module",
                side_effect=[object(), ImportError("no pdfium")],
            ),
        ):
            result = compare_pdfs(Path("a.pdf"), Path("b.pdf"), [])
        self.assertFalse(result["visualInspection"]["available"])
        self.assertFalse(result["observedParity"])
        self.assertNotIn("text", result["baseline"]["pages"][0])
        json.dumps(result)

    def test_visual_resources_require_close_but_not_context_manager_support(self):
        closed = []
        rgb = SimpleNamespace(close=lambda: closed.append("rgb"))
        rendered = SimpleNamespace(convert=lambda mode: rgb, close=lambda: closed.append("image"))
        bitmap = SimpleNamespace(to_pil=lambda: rendered, close=lambda: closed.append("bitmap"))
        text = SimpleNamespace(close=lambda: closed.append("text"))
        page = SimpleNamespace(
            get_textpage=lambda: text,
            render=lambda scale: bitmap,
            close=lambda: closed.append("page"),
        )

        class Document:
            def __len__(self):
                return 1

            def __getitem__(self, index):
                return page

            def close(self):
                closed.append("document")

        library = SimpleNamespace(PdfDocument=lambda path: Document())
        pages = [{"page": 1}]
        with (
            patch(MODULE + ".compare_rasters", return_value={"changedFraction": 0}),
            patch(MODULE + ".importlib.import_module", side_effect=[library, object()]),
        ):
            result = inspect_visuals((Path("a"), Path("b")), pages, [], 96)
        self.assertTrue(result["available"])
        for resource in ("document", "page", "bitmap", "image", "rgb", "text"):
            self.assertEqual(closed.count(resource), 2)

    def assert_output_alias_rejected(self, alias_kind, source_side):
        original = b"%PDF-1.4\noriginal input bytes\n"
        with tempfile.TemporaryDirectory() as directory:
            inputs = [Path(directory) / "baseline.pdf", Path(directory) / "candidate.pdf"]
            for source in inputs:
                source.write_bytes(original)
            source = inputs[source_side]
            alias = Path(directory) / "alias.json"
            if alias_kind == "direct":
                alias = source
            else:
                try:
                    if alias_kind == "symlink":
                        alias.symlink_to(source)
                    else:
                        os.link(source, alias)
                except OSError as error:
                    self.skipTest(f"{alias_kind} unavailable: {error}")
            with (
                patch(MODULE + ".compare_pdfs") as compare,
                contextlib.redirect_stderr(io.StringIO()) as errors,
                self.assertRaises(SystemExit) as stopped,
            ):
                main([str(inputs[0]), str(inputs[1]), "--output", str(alias)])
            self.assertEqual(stopped.exception.code, 2)
            compare.assert_not_called()
            self.assertIn("must not overwrite", errors.getvalue())
            for source in inputs:
                self.assertEqual(source.read_bytes(), original)
            self.assertEqual(alias.read_bytes(), original)

    def test_output_direct_input_alias_rejected(self):
        for source_side in (0, 1):
            with self.subTest(source_side=source_side):
                self.assert_output_alias_rejected("direct", source_side)

    def test_output_symlink_input_alias_rejected(self):
        for source_side in (0, 1):
            with self.subTest(source_side=source_side):
                self.assert_output_alias_rejected("symlink", source_side)

    def test_output_hardlink_input_alias_rejected(self):
        for source_side in (0, 1):
            with self.subTest(source_side=source_side):
                self.assert_output_alias_rejected("hardlink", source_side)

    def test_malformed_pdf_reader_failure_is_not_an_empty_document(self):
        from unittest.mock import Mock

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.pdf"
            path.write_bytes(b"not a PDF")
            library = SimpleNamespace(PdfReader=Mock(side_effect=ValueError("invalid header")))
            with self.assertRaisesRegex(ValueError, "invalid header"):
                inspect_pdf(path, library)

    def test_cli_writes_json_for_nonparity_and_validates_parameters(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "comparison.json"
            with patch(MODULE + ".compare_pdfs", return_value={"observedParity": False}):
                self.assertEqual(main(["a.pdf", "b.pdf", "--output", str(output)]), 1)
            self.assertEqual(json.loads(output.read_text()), {"observedParity": False})
        for arguments in (["--dpi", "144"], ["--anchor", " "]):
            with (
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as stopped,
            ):
                main(["a.pdf", "b.pdf", *arguments])
            self.assertEqual(stopped.exception.code, 2)

    def test_invalid_parameters_and_malformed_pdf_exit_two(self):
        with self.assertRaisesRegex(ValueError, "dpi"):
            compare_pdfs(Path("a"), Path("b"), [], 144)
        with self.assertRaisesRegex(ValueError, "anchors"):
            compare_pdfs(Path("a"), Path("b"), [" "])
        with (
            self.assertRaisesRegex(RuntimeError, "pypdf"),
            patch(MODULE + ".importlib.import_module", side_effect=ImportError("no pypdf")),
        ):
            compare_pdfs(Path("a"), Path("b"), [])
        with (
            patch(MODULE + ".compare_pdfs", side_effect=ValueError("malformed PDF")),
            contextlib.redirect_stderr(io.StringIO()) as error,
            self.assertRaises(SystemExit) as stopped,
        ):
            main(["bad.pdf", "other.pdf"])
        self.assertEqual(stopped.exception.code, 2)
        self.assertIn("malformed PDF", error.getvalue())


if __name__ == "__main__":
    unittest.main()
