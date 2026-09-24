"""Read the post-build statistic contract for standalone Word acceptance."""

import json
import sys

from .orchestrator import create_replacements
from .statistics import get_counts_from_docx


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "Usage: python -m scripts.sto_post_build.acceptance_statistics <docx>", file=sys.stderr
        )
        return 2
    counts = get_counts_from_docx(sys.argv[1])
    print(
        json.dumps(
            {
                "figures": counts.figures,
                "tables": counts.tables,
                "sources": counts.sources,
                "replacements": create_replacements(counts.figures, counts.tables, counts.sources),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
