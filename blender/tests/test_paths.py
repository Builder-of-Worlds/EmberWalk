import os
import subprocess
import tempfile
import unittest

import support
from ewscene import paths


class FakeImage:
    def __init__(self, filepath, source="FILE"):
        self.filepath = filepath
        self.source = source
        self.reloads = 0

    def reload(self):
        self.reloads += 1


class Paths(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in ("EMBERWALK_RENDERS", "EMBERWALK_ASSETS", "EMBERWALK_SESSION")}

    def tearDown(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v

    def test_renders_dir_follows_the_environment(self):
        os.environ["EMBERWALK_RENDERS"] = "/tmp/x"
        self.assertEqual(paths.renders_dir(), "/tmp/x")

    def test_folders_default_inside_the_venture_folder_never_home(self):
        root = paths.venture_root()
        main = os.path.dirname(subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=support.BLENDER_DIR,
                                              capture_output=True, text=True, check=True).stdout.strip())
        self.assertEqual(root, os.path.dirname(main))
        self.assertEqual(paths.renders_dir(), os.path.join(root, "emberwalk-renders"))
        self.assertEqual(paths.assets_dir(), os.path.join(root, "emberwalk-assets"))
        self.assertNotEqual(os.path.dirname(paths.renders_dir()), os.path.expanduser("~"))

    def test_a_clone_without_the_marker_uses_the_folder_holding_its_main_checkout(self):
        with tempfile.TemporaryDirectory() as base:
            base = os.path.realpath(base)
            clone = os.path.join(base, "EmberWalk")
            subprocess.run(["git", "init", "-q", clone], check=True)
            deep = os.path.join(clone, "blender", "ewscene")
            os.makedirs(deep)
            self.assertFalse(os.path.exists(os.path.join(base, ".venture-root")))
            self.assertEqual(paths.venture_root(os.path.join(deep, "paths.py")), base)

    def test_venture_root_is_the_nearest_folder_with_the_marker(self):
        with tempfile.TemporaryDirectory() as base:
            deep = os.path.join(base, "EmberWalk", "nested", "copy", "blender", "ewscene")
            os.makedirs(deep)
            open(os.path.join(base, ".venture-root"), "w").close()
            self.assertEqual(paths.venture_root(os.path.join(deep, "paths.py")), base)

    def test_no_marker_is_an_error_naming_the_variables(self):
        with tempfile.TemporaryDirectory() as base:
            with self.assertRaises(RuntimeError) as e:
                paths.venture_root(os.path.join(base, "paths.py"))
            self.assertIn("EMBERWALK_RENDERS", str(e.exception))

    def test_images_saved_under_any_assets_folder_move_to_the_current_one(self):
        old = FakeImage("/old/home/emberwalk-assets/polyhaven/bark/1k/bark_diff_1k.jpg")
        here = FakeImage("/new/emberwalk-assets/polyhaven/bark/1k/bark_rough_1k.jpg")
        render = FakeImage("//frame.png")
        packed = FakeImage("/old/home/emberwalk-assets/polyhaven/x.jpg", source="GENERATED")
        moved = paths.repath_images([old, here, render, packed], "/new/emberwalk-assets")
        self.assertEqual(old.filepath, "/new/emberwalk-assets/polyhaven/bark/1k/bark_diff_1k.jpg")
        self.assertEqual((old.reloads, here.reloads, render.reloads, packed.reloads), (1, 0, 0, 0))
        self.assertEqual(render.filepath, "//frame.png")
        self.assertEqual(packed.filepath, "/old/home/emberwalk-assets/polyhaven/x.jpg")
        self.assertEqual(moved, 1)

    def test_relink_moves_linked_libraries_and_images(self):
        lib = FakeImage("/old/home/emberwalk-assets/polyhaven/trunk/1k/trunk_1k.blend")
        del lib.source
        im = FakeImage("/old/home/emberwalk-assets/openart/log.png")

        class Data:
            libraries = [lib]
            images = [im]

        self.assertEqual(paths.relink(Data, "/m/emberwalk-assets"), 2)
        self.assertEqual(lib.filepath, "/m/emberwalk-assets/polyhaven/trunk/1k/trunk_1k.blend")
        self.assertEqual(im.filepath, "/m/emberwalk-assets/openart/log.png")

    def test_a_session_renders_into_its_own_numbered_folder(self):
        os.environ["EMBERWALK_RENDERS"] = "/r"
        with tempfile.TemporaryDirectory() as code:
            subprocess.run(["git", "init", "-q", "-b", "work/123-yard-walk", code], check=True)
            self.assertEqual(paths.session_dir(code), "/r/123-yard-walk")
            os.environ["EMBERWALK_SESSION"] = "456-other"
            try:
                self.assertEqual(paths.session_dir(code), "/r/456-other")
            finally:
                del os.environ["EMBERWALK_SESSION"]

    def test_no_session_number_is_an_error_not_a_loose_folder(self):
        os.environ["EMBERWALK_RENDERS"] = "/r"
        with tempfile.TemporaryDirectory() as code:
            subprocess.run(["git", "init", "-q", "-b", "main", code], check=True)
            with self.assertRaises(RuntimeError) as e:
                paths.session_dir(code)
            self.assertIn("EMBERWALK_SESSION", str(e.exception))
            os.environ["EMBERWALK_SESSION"] = "renders"
            try:
                with self.assertRaises(RuntimeError):
                    paths.session_dir(code)
            finally:
                del os.environ["EMBERWALK_SESSION"]

    def test_script_args_are_after_the_double_dash(self):
        self.assertEqual(paths.script_args(["blender", "-b", "--python", "x.py", "--", "a", "--out", "b"]), ["a", "--out", "b"])
        self.assertEqual(paths.script_args(["blender", "-b"]), [])


if __name__ == "__main__":
    unittest.main()
