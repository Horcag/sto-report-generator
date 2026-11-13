"""Wall-clock receipts for native post-build stages, including failed stages."""

import time
from collections.abc import Callable


def timed_stage[T, **P](
    name: str, operation: Callable[P, T], *args: P.args, **kwargs: P.kwargs
) -> T:
    started = time.perf_counter()
    print(f"Word post-build stage: {name}", flush=True)
    status = "failed"
    try:
        result = operation(*args, **kwargs)
        status = "ok"
        return result
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        print(f"Word post-build timing: {name} {elapsed_ms:.0f} ms ({status})", flush=True)
