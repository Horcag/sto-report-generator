import sys
from collections.abc import Sequence

from .orchestrator import format_post_build_summary, post_build

USAGE = "Usage: python post_build.py <path_to_docx> [report_source_dir] [pdf_output_path]"


def run(argv: Sequence[str]) -> int:
    if not argv:
        print(USAGE, file=sys.stderr)
        return 1

    try:
        result = post_build(
            argv[0],
            argv[1] if len(argv) > 1 else None,
            argv[2] if len(argv) > 2 else None,
        )
    except Exception as error:
        print(f"Error during post-build: {error}", file=sys.stderr)
        return 1

    print(format_post_build_summary(result))
    return 0
