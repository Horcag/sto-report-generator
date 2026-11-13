"""Create Word COM with optional exact-process ownership journaling."""

import os
import platform
from pathlib import Path
from typing import Any


def create_word_application() -> Any:
    if platform.system() != "Windows":
        raise RuntimeError(
            "Word renderer requires native Windows with Microsoft Word and pywin32. "
            "Use --renderer portable on Linux, WSL, or macOS, or rerun --renderer word on native Windows."
        )
    try:
        import win32com.client
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Word renderer requires pywin32. Install Python dependencies with uv sync on native Windows, "
            "then rerun --renderer word."
        ) from error

    owned_processes_before = None
    if os.environ.get("STO_WORD_OWNERSHIP_DIR"):
        import win32process

        owned_processes_before = set(win32process.EnumProcesses())
        import json
        import uuid

        snapshot = (
            Path(os.environ["STO_WORD_OWNERSHIP_DIR"])
            / f"post-build-before-{uuid.uuid4().hex}.json"
        )
        snapshot.write_text(json.dumps(sorted(owned_processes_before)), encoding="utf-8")
    word = win32com.client.DispatchEx("Word.Application")
    if os.environ.get("STO_WORD_OWNERSHIP_DIR"):
        from .process_ownership import record_word_application

        record_word_application(word, owned_processes_before or set())
    word.Visible = os.environ.get("STO_WORD_INTERACTION_MODE") == "interactive"
    word.DisplayAlerts = False
    return word
