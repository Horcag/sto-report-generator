"""Red paths for documentation resources and narrowly allowed case-study CSV."""

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.quality.check_documentation import main, validate_csv, validate_links


class DocumentationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        (self.root / "README.md").write_text("# Guide\n", newline="\n")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        return path

    def test_changed_skill_missing_resource_is_rejected(self):
        name = ".agents/skills/report/SKILL.md"
        self.write(name, "# Guide\n[Resource](references/missing.md)\n")
        self.assertTrue(validate_links(self.root, [name]))
        self.write(".agents/skills/report/references/missing.md", "# Resource\n")
        self.assertEqual(validate_links(self.root, [name]), [])

    def test_deleted_resource_breaks_unchanged_skill_reference(self):
        self.write(".agents/skills/report/SKILL.md", "# Guide\n[Resource](references/deleted.md)\n")
        self.assertTrue(validate_links(self.root, [".agents/skills/report/references/deleted.md"]))

    def test_deleted_document_breaks_readme_reference(self):
        self.write("README.md", "# Guide\n[Old](docs/deleted.md)\n")
        self.assertTrue(validate_links(self.root, ["docs/deleted.md"]))

    def test_valid_case_study_csv_with_quoted_records(self):
        path = self.write(
            "docs/case-studies/data.csv", 'id,reference,description\n1,R01,"A, B"\n2,R02,"A\nB"\n'
        )
        validate_csv(path, self.root)

    def test_csv_rejects_invalid_records_and_controls(self):
        for text in [
            "",
            "id,value\n",
            "id,id\n1,2\n",
            "id,\n1,2\n",
            "id,value\n1\n",
            "id,value\n\n",
            "id,value\n,\n",
            'id,value\n1,"unclosed\n',
            "id,value\n1,\x00\n",
        ]:
            with self.subTest(text=text):
                path = self.write("docs/case-studies/data.csv", text)
                with self.assertRaises((ValueError, csv.Error)):
                    validate_csv(path, self.root)

    def test_csv_resource_links_are_not_fetched(self):
        path = self.write(
            "docs/case-studies/data.csv", "id,source_url\n1,https://example.invalid/document\n"
        )
        validate_csv(path, self.root)
        path.write_text("id,source_path\n1,missing.md\n", newline="\n")
        with self.assertRaisesRegex(ValueError, "resource link"):
            validate_csv(path, self.root)

    def test_cli_rejects_skill_without_description_before_package_or_rendering(self):
        name = ".agents/skills/example/SKILL.md"
        self.write(name, "---\nname: example\n---\n\n# Example\n")
        repository = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [
                sys.executable,
                str(repository / "scripts/quality/check_documentation.py"),
                "--tool-root",
                str(repository),
            ],
            cwd=self.root,
            env={**os.environ, "CHANGE_SCOPE_JSON": json.dumps({"files": [name]})},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing skill description", result.stderr)
        self.assertNotIn("check_line_endings.py", result.stdout)
        self.assertNotIn("run_pack_content_check", result.stdout)

    def test_docs_main_rejects_escaping_paths_before_tools_run(self):
        with (
            patch("sys.argv", ["check_documentation.py"]),
            patch("pathlib.Path.cwd", return_value=self.root),
            patch.dict("os.environ", {"CHANGE_SCOPE_JSON": '{"files":["../outside.md"]}'}),
            patch("subprocess.run") as runner,
        ):
            with self.assertRaisesRegex(ValueError, "escapes"):
                main()
            runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
