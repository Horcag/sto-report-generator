"""Provenance and corpus orchestration tests; PDF libraries are never required."""

import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from scripts.quality.check_renderer_parity import main, resolve_path, run_corpus, sha256


class RendererParityTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="sto-parity-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.docx"
        self.source.write_bytes(b"frozen source DOCX fixture")
        self.word_pdf, self.candidate_pdf = self.root / "word.pdf", self.root / "candidate.pdf"
        self.word_pdf.write_bytes(b"%PDF-1.4\nword")
        self.candidate_pdf.write_bytes(b"%PDF-1.4\nwordcraft")
        receipts = self.root / "receipts"
        receipts.mkdir()
        self.word_manifest, self.candidate_manifest = (
            receipts / "word.json",
            receipts / "candidate.json",
        )
        self.word = {
            "renderer": "word-desktop-interactive",
            "status": "accepted",
            "stablePageCount": True,
            "capabilityChecks": {"stablePageCount": True},
            "execution": {"processCleanupVerified": True},
            "inputDocx": {"path": "../source.docx", "sha256": sha256(self.source)},
            "pdf": {"path": "../word.pdf", "sha256": sha256(self.word_pdf)},
            "pageCountAfterReopen": 2,
        }
        self.candidate = {
            "renderer": "wordcraft",
            "version": "0.9.0",
            "inputDocx": "../source.docx",
            "sourceSha256": sha256(self.source),
            "outputPdf": "../candidate.pdf",
            "pdfSha256": sha256(self.candidate_pdf),
            "pageCount": 3,
            "warnings": ["Experimental renderer"],
            "fonts": {"missingFamilies": ["Cambria Math"]},
        }
        self.case = {
            "id": "example",
            "sourceDocx": "source.docx",
            "wordManifest": "receipts/word.json",
            "wordcraftManifest": "receipts/candidate.json",
            "anchors": ["Introduction"],
        }
        self.manifest = self.root / "corpus.json"
        self.write_receipts()
        self.write_cases([self.case])
        self.parity = False
        self.comparator = patch(
            "scripts.quality.check_renderer_parity.compare_pdfs", side_effect=self.metrics
        ).start()
        self.addCleanup(patch.stopall)

    def write_receipts(self) -> None:
        self.word_manifest.write_text(json.dumps(self.word), encoding="utf-8")
        self.candidate_manifest.write_text(json.dumps(self.candidate), encoding="utf-8")

    def write_cases(self, cases: object) -> None:
        self.manifest.write_text(json.dumps({"cases": cases}), encoding="utf-8")

    def metrics(self, baseline: Path, candidate: Path, anchors: list[str], dpi: int) -> dict:
        self.assertEqual(anchors, ["Introduction"])
        self.assertIn(dpi, (72, 96))
        return {
            "baseline": {"sha256": sha256(baseline), "pageCount": 2},
            "candidate": {"sha256": sha256(candidate), "pageCount": 3},
            "pages": [{"page": 3, "matched": False, "unmatchedSide": "candidate"}],
            "observedParity": self.parity,
        }

    def assert_provenance_failure(self, pattern: str) -> None:
        result = run_corpus(self.manifest)
        self.assertEqual(result["cases"][0]["status"], "provenance-failed")
        self.assertRegex(result["cases"][0]["error"], pattern)
        self.assertNotIn("metrics", result["cases"][0])
        self.assertFalse(result["observedParity"])
        self.comparator.assert_not_called()

    def test_verified_corpus_keeps_distinct_page_counts_and_warnings(self) -> None:
        result = run_corpus(self.manifest, dpi=72)
        case = result["cases"][0]
        self.assertEqual(case["status"], "compared")
        self.assertEqual(case["metrics"]["baseline"]["pageCount"], 2)
        self.assertEqual(case["metrics"]["candidate"]["pageCount"], 3)
        self.assertEqual(case["reportedDocxPages"], {"word": 2, "wordcraft": 3})
        self.assertIn("Wordcraft unavailable font: Cambria Math", case["warnings"])
        self.assertEqual(case["sourceSha256"], sha256(self.source))
        self.assertEqual(case["wordManifestSha256"], sha256(self.word_manifest))
        self.assertFalse(result["observedParity"])
        self.assertEqual(result["summary"]["compared"], 1)
        self.assertEqual(result["aggregateMetrics"]["baselinePdfPages"], 2)
        self.assertEqual(result["aggregateMetrics"]["candidatePdfPages"], 3)
        self.assertEqual(result["aggregateMetrics"]["unmatchedPages"], 1)

    def test_all_cases_required_for_overall_parity(self) -> None:
        second = {**self.case, "id": "math"}
        self.write_cases([self.case, second])
        self.parity = True
        result = run_corpus(self.manifest)
        self.assertTrue(result["observedParity"])
        self.assertEqual(result["summary"]["observedParity"], 2)

    def test_malformed_and_duplicate_cases_fail_closed(self) -> None:
        for cases in (
            [],
            None,
            {},
            [None],
            [self.case, self.case],
            [{**self.case, "id": " "}],
            [{**self.case, "anchors": [""]}],
            [{**self.case, "sourceDocx": 4}],
        ):
            with self.subTest(cases=cases):
                self.write_cases(cases)
                with self.assertRaises(ValueError):
                    run_corpus(self.manifest)
        self.comparator.assert_not_called()

    def test_invalid_json_and_root_fail_closed(self) -> None:
        for content in ("invalid", "[]"):
            self.manifest.write_text(content, encoding="utf-8")
            with self.assertRaises(ValueError):
                run_corpus(self.manifest)

    def test_both_source_receipt_hashes_must_match(self) -> None:
        self.candidate["sourceSha256"] = "0" * 64
        self.write_receipts()
        self.assert_provenance_failure("Wordcraft input DOCX.*mismatch")

    def test_word_source_receipt_must_match(self) -> None:
        self.word["inputDocx"]["sha256"] = "0" * 64
        self.write_receipts()
        self.assert_provenance_failure("Word input DOCX.*mismatch")

    def test_recorded_source_path_content_must_match(self) -> None:
        other = self.root / "other.docx"
        other.write_bytes(b"another source")
        self.candidate["inputDocx"] = "../other.docx"
        self.write_receipts()
        self.assert_provenance_failure("recorded input DOCX.*mismatch")

    def test_pdf_hash_and_signature_must_match(self) -> None:
        self.candidate_pdf.write_bytes(b"modified")
        self.assert_provenance_failure("candidatePdf.*mismatch")
        self.candidate["pdfSha256"] = sha256(self.candidate_pdf)
        self.write_receipts()
        self.assert_provenance_failure("invalid PDF signature")

    def test_acceptance_flags_require_literal_true(self) -> None:
        baseline = copy.deepcopy(self.word)
        for field, value in (
            ("status", "pendingCleanup"),
            ("stablePageCount", 1),
            ("capabilityChecks", {"stablePageCount": False}),
            ("execution", {"processCleanupVerified": "true"}),
        ):
            with self.subTest(field=field):
                self.word = {**baseline, field: value}
                self.write_receipts()
                self.assert_provenance_failure(
                    "accepted status|stablePageCount|processCleanupVerified"
                )

    def test_malformed_receipt_and_version_fail(self) -> None:
        self.candidate["version"] = None
        self.write_receipts()
        self.assert_provenance_failure("version")
        self.candidate_manifest.write_text("[]", encoding="utf-8")
        self.assert_provenance_failure("JSON object")

    def test_missing_optional_pdf_libraries_produces_no_metrics(self) -> None:
        self.comparator.side_effect = RuntimeError("optional pypdf is required")
        result = run_corpus(self.manifest)
        self.assertEqual(result["cases"][0]["status"], "comparison-unavailable")
        self.assertNotIn("metrics", result["cases"][0])
        self.assertFalse(result["observedParity"])

    def test_changed_artifact_after_comparison_is_provenance_failure(self) -> None:
        def mutate(*args: object) -> dict:
            result = self.metrics(*args)
            self.source.write_bytes(b"changed during comparison")
            return result

        self.comparator.side_effect = mutate
        result = run_corpus(self.manifest)
        self.assertEqual(result["cases"][0]["status"], "provenance-failed")
        self.assertNotIn("metrics", result["cases"][0])

    def test_comparator_hash_must_match_receipt(self) -> None:
        result = self.metrics(self.word_pdf, self.candidate_pdf, ["Introduction"], 96)
        result["baseline"]["sha256"] = "0" * 64
        self.comparator.side_effect = None
        self.comparator.return_value = result
        result = run_corpus(self.manifest)
        self.assertEqual(result["cases"][0]["status"], "provenance-failed")
        self.assertNotIn("metrics", result["cases"][0])

    def test_output_aliases_for_all_inputs_are_rejected_before_compare(self) -> None:
        for source in (
            self.manifest,
            self.source,
            self.word_manifest,
            self.candidate_manifest,
            self.word_pdf,
            self.candidate_pdf,
        ):
            original = source.read_bytes()
            for kind in ("direct", "hard", "symbolic"):
                with self.subTest(source=source, kind=kind):
                    output = source if kind == "direct" else self.root / "alias.json"
                    if kind == "hard":
                        os.link(source, output)
                    elif kind == "symbolic":
                        output.symlink_to(source)
                    try:
                        with self.assertRaisesRegex(ValueError, "overwrite"):
                            run_corpus(self.manifest, output=output)
                        self.assertEqual(source.read_bytes(), original)
                    finally:
                        if output != source:
                            output.unlink()
        self.comparator.assert_not_called()

    def test_output_pdf_protected_even_if_other_receipt_is_malformed(self) -> None:
        self.candidate_manifest.write_text("invalid", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "overwrite"):
            run_corpus(self.manifest, output=self.word_pdf)

    def test_failed_source_resolution_still_protects_receipts_and_artifacts(self) -> None:
        missing_source = r"C:\unavailable\source.docx"
        self.write_cases([{**self.case, "sourceDocx": missing_source}])
        originals = {
            path: path.read_bytes()
            for path in (
                self.manifest,
                self.source,
                self.word_manifest,
                self.candidate_manifest,
                self.word_pdf,
                self.candidate_pdf,
            )
        }

        def resolve_available(value: object, parent: Path) -> Path:
            if value == missing_source:
                raise FileNotFoundError("wslpath unavailable")
            return resolve_path(value, parent)

        with patch(
            "scripts.quality.check_renderer_parity.resolve_path", side_effect=resolve_available
        ):
            for output in originals:
                with self.subTest(output=output):
                    for path, content in originals.items():
                        path.write_bytes(content)
                    error = io.StringIO()
                    with redirect_stderr(error), self.assertRaises(SystemExit) as stopped:
                        main([str(self.manifest), "--output", str(output)])
                    self.assertEqual(stopped.exception.code, 2)
                    self.assertIn("overwrite", error.getvalue())
                    for path, content in originals.items():
                        self.assertEqual(path.read_bytes(), content)
            result = run_corpus(self.manifest)
        self.assertEqual(result["cases"][0]["status"], "provenance-failed")
        self.assertIn("sourceDocx", result["cases"][0]["error"])
        self.assertIn("wslpath unavailable", result["cases"][0]["error"])
        self.comparator.assert_not_called()
        self.assertEqual(list(self.root.glob(".sto-parity-*")), [])

    def test_malformed_input_path_still_protects_known_pdf(self) -> None:
        self.candidate["inputDocx"] = 42
        self.write_receipts()
        with self.assertRaisesRegex(ValueError, "overwrite"):
            run_corpus(self.manifest, output=self.candidate_pdf)

    def test_missing_fonts_report_evidence_gap(self) -> None:
        del self.candidate["fonts"]
        self.write_receipts()
        result = run_corpus(self.manifest)
        self.assertIn(
            "Wordcraft font preflight evidence unavailable.", result["cases"][0]["warnings"]
        )

    def test_windows_receipt_path_uses_bounded_wsl_translation(self) -> None:
        if os.name == "nt":
            self.skipTest("WSL-only path translation")
        with patch(
            "scripts.quality.check_renderer_parity.subprocess.run",
            return_value=CompletedProcess([], 0, str(self.source) + "\n", ""),
        ) as command:
            self.assertEqual(resolve_path(r"C:\source.docx", self.root), self.source)
            command.assert_called_once_with(
                ["wslpath", "-u", r"C:\source.docx"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )

    def test_cli_writes_atomic_report_and_exit_codes(self) -> None:
        output = self.root / "report.json"
        self.assertEqual(main([str(self.manifest), "--output", str(output)]), 1)
        self.assertEqual(json.loads(output.read_text())["summary"]["compared"], 1)
        self.assertEqual(list(self.root.glob(".sto-parity-*")), [])
        self.parity = True
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main([str(self.manifest)]), 0)
        self.comparator.side_effect = RuntimeError("PDF dependency unavailable")
        self.assertEqual(main([str(self.manifest), "--output", str(output)]), 2)


if __name__ == "__main__":
    unittest.main()
