"""Record exact native process identities for the bounded Word launcher."""

import ctypes
import json
import os
import subprocess
from pathlib import Path
from typing import Any


def process_identity(pid: int) -> dict[str, str | int]:
    from ctypes import wintypes

    native: Any = ctypes
    kernel = native.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise native.WinError(native.get_last_error())
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            raise native.WinError(native.get_last_error())
        size = wintypes.DWORD(32768)
        executable = ctypes.create_unicode_buffer(size.value)
        if not kernel.QueryFullProcessImageNameW(handle, 0, executable, ctypes.byref(size)):
            raise native.WinError(native.get_last_error())
        ticks = (times[0].dwHighDateTime << 32) + times[0].dwLowDateTime + 504911232000000000
        return {"pid": pid, "startTimeUtcTicks": str(ticks), "executablePath": executable.value}
    finally:
        kernel.CloseHandle(handle)


def record_process(pid: int, name: str) -> None:
    directory = os.environ.get("STO_WORD_OWNERSHIP_DIR")
    if not directory:
        return
    identity = process_identity(pid)
    root = Path(directory)
    (root / f"{name}.json").write_text(json.dumps(identity), encoding="utf-8")
    (root / f"{name}.pid").write_text(str(pid), encoding="utf-8")


def record_word_application(word: object, before: set[int]) -> None:
    import time

    import win32process

    try:
        _, pid = win32process.GetWindowThreadProcessId(word.Hwnd)  # type: ignore[attr-defined]
    except AttributeError:
        pid = 0
        for _ in range(10):
            candidates = []
            for candidate in set(win32process.EnumProcesses()) - before:
                try:
                    identity = process_identity(candidate)
                except OSError:
                    continue
                if Path(str(identity["executablePath"])).name.upper() == "WINWORD.EXE":
                    candidates.append(candidate)
            if len(candidates) == 1:
                pid = candidates[0]
                break
            if len(candidates) > 1:
                raise RuntimeError(
                    "Word activation exposed multiple new processes; ownership is ambiguous."
                )
            time.sleep(0.1)
    if not pid or pid in before:
        raise RuntimeError("Word did not expose a new owned process; refusing automation.")
    record_process(pid, f"post-build-word-{pid}")


def run_owned_subprocess(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    """Journal native converter/helper children before waiting on their output."""
    input_text = kwargs.pop("input", None)
    timeout = kwargs.pop("timeout", None)
    check = kwargs.pop("check", False)
    kwargs.pop("capture_output", None)
    with subprocess.Popen(
        args,
        stdin=subprocess.PIPE if input_text is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        **kwargs,
    ) as process:
        record_process(process.pid, f"post-build-child-{process.pid}")
        try:
            stdout, stderr = process.communicate(input_text, timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
        result = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result
