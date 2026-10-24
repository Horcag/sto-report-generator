"""Check native PDF geometry for tests/fixtures/formulas/layout.md (PyMuPDF required)."""

import argparse
import hashlib
import json
import re
from pathlib import Path

import pymupdf

ANCHORS = {
    1: "Plain",
    2: "Brier",
    3: "Fraction",
    4: "Integral",
    5: "Matrix",
    6: "Cases",
    7: "Fences",
    8: "Roles",
    9: "Finish",
    10: "Last",
    11: "Tall",
    12: "System",
    13: "Conditions",
    14: "Array",
}


def inspect_pdf(pdf: Path) -> dict:
    rules = json.loads(
        (Path(__file__).resolve().parents[2] / "src/shared/config/sto-rules.json").read_text()
    )
    right_margin = rules["page"]["marginsDxa"]["right"] / 20
    document = pymupdf.open(pdf)
    cases = []
    seen = set()
    try:
        for page_number, page in enumerate(document, 1):
            if re.fullmatch(r"\s*\d+\s*", page.get_text()):
                raise AssertionError(f"Page {page_number} contains only its page number")
            spans = [
                span
                for block in page.get_text("dict")["blocks"]
                for line in block.get("lines", [])
                for span in line["spans"]
            ]
            for word in page.get_text("words"):
                match = re.fullmatch(r"\((\d+)\)", word[4])
                if not match or word[0] < page.rect.width - 100:
                    continue
                number = int(match[1])
                if number not in ANCHORS or number in seen:
                    raise AssertionError(f"Unexpected or duplicated equation number {number}")
                seen.add(number)
                labels = [span for span in spans if span["text"].strip() == word[4]]
                anchors = [span for span in spans if span["text"].strip() == ANCHORS[number]]
                if len(labels) != 1 or len(anchors) != 1:
                    raise AssertionError(
                        f"Equation {number}: expected unique label and anchor on page"
                    )
                number_y = labels[0]["origin"][1]
                formula_y = anchors[0]["origin"][1]
                delta = abs(number_y - formula_y)
                right_delta = abs(word[2] - (page.rect.width - right_margin))
                if delta > 2 or right_delta > 2:
                    raise AssertionError(
                        f"Equation {number}: baseline difference {delta:.2f}pt, "
                        f"right-margin difference {right_delta:.2f}pt"
                    )
                cases.append(
                    {
                        "equation": number,
                        "anchor": ANCHORS[number],
                        "page": page_number,
                        "number_baseline_pt": round(number_y, 3),
                        "formula_baseline_pt": round(formula_y, 3),
                        "baseline_difference_pt": round(delta, 3),
                        "right_margin_difference_pt": round(right_delta, 3),
                    }
                )
        if seen != set(ANCHORS):
            raise AssertionError(f"Missing expected equation cases: {set(ANCHORS) - seen}")
        return {
            "status": "passed",
            "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": len(document),
            "tolerance_pt": 2,
            "tolerance_basis": "fixture regression tolerance, not an STO allowance",
            "cases": cases,
        }
    finally:
        document.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    result = inspect_pdf(args.pdf)
    if args.receipt:
        args.receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Formula PDF geometry: {len(result['cases'])} expected cases passed.")


if __name__ == "__main__":
    main()
