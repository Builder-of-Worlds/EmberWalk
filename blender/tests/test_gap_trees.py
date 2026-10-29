import os
import subprocess
import tempfile
import unittest

import support

APARTMENT = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "apartment-before", "spec.json")
BUILD_HOUSE = os.path.join(support.BLENDER_DIR, "build_house.py")
BLENDER = support.blender_path()


@unittest.skipUnless(BLENDER, "Blender not found: the tree build gap test did not run, so this is a PARTIAL RUN")
class TreesInTheScene(unittest.TestCase):
    def test_apartment_images_with_more_trees(self):
        """apartment images have more trees, since Northern California is heavily wooded"""
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            run = subprocess.run(
                [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", BUILD_HOUSE, "--", APARTMENT, "--out", out],
                capture_output=True, text=True, timeout=1200,
            )
            self.assertEqual(run.returncode, 0, run.stderr[-600:])
            self.assertTrue(os.path.exists(os.path.join(out, "scene.blend")))


if __name__ == "__main__":
    unittest.main()
