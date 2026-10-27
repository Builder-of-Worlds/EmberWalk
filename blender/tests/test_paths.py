import os
import unittest

import support
from ewscene import paths


class Paths(unittest.TestCase):
    def test_renders_dir_follows_the_environment(self):
        old = os.environ.get("EMBERWALK_RENDERS")
        try:
            os.environ["EMBERWALK_RENDERS"] = "/tmp/x"
            self.assertEqual(paths.renders_dir(), "/tmp/x")
            del os.environ["EMBERWALK_RENDERS"]
            self.assertEqual(paths.renders_dir(), os.path.expanduser("~/emberwalk-renders"))
        finally:
            if old is not None:
                os.environ["EMBERWALK_RENDERS"] = old

    def test_script_args_are_after_the_double_dash(self):
        self.assertEqual(paths.script_args(["blender", "-b", "--python", "x.py", "--", "a", "--out", "b"]), ["a", "--out", "b"])
        self.assertEqual(paths.script_args(["blender", "-b"]), [])


if __name__ == "__main__":
    unittest.main()
