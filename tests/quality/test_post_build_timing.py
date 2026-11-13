import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from scripts.sto_post_build.timing import timed_stage


class PostBuildTimingTests(unittest.TestCase):
    def test_return_and_elapsed_wall_time_are_preserved(self):
        output = io.StringIO()
        sentinel = object()
        with (
            redirect_stdout(output),
            patch("scripts.sto_post_build.timing.time.perf_counter", side_effect=[10.0, 12.5]),
        ):
            self.assertIs(timed_stage("export", lambda value: value, sentinel), sentinel)
        self.assertIn("export 2500 ms (ok)", output.getvalue())

    def test_exception_keeps_original_identity_and_failed_receipt(self):
        error = RuntimeError("native failure")
        output = io.StringIO()

        def fail():
            raise error

        with redirect_stdout(output), self.assertRaises(RuntimeError) as caught:
            timed_stage("export", fail)
        self.assertIs(caught.exception, error)
        self.assertIn("(failed)", output.getvalue())


if __name__ == "__main__":
    unittest.main()
