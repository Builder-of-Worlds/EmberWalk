import json
import math
import os
import subprocess
import unittest

import support

PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_photo_carriers.py")
BLENDER = support.blender_path()
APARTMENT = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "apartment-before", "spec.json")


def spec():
    return support.load_json(APARTMENT)


@unittest.skipUnless(BLENDER, "Blender not found: the photo carrier probe did not run, so this is a PARTIAL RUN")
class PhotoCarriers(unittest.TestCase):
    """In the photo look the trees that carry a branch hazard are photoscan trees too, with a limb to the branch."""

    @classmethod
    def setUpClass(cls):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE],
                             capture_output=True, text=True, timeout=900)
        cls.err = run.stderr[-800:] + run.stdout[-400:]
        line = next((l for l in run.stdout.splitlines() if l.startswith("EW_CARRIERS ")), None)
        cls.scene = json.loads(line[12:]) if line else None

    def setUp(self):
        self.assertTrue(self.scene, self.err)

    def carriers(self):
        return [t for t in spec()["trees"] if t["branches"]]

    def test_every_tree_of_the_apartment_lot_is_a_photoscan_model(self):
        for t in spec()["trees"]:
            parts = [p for p in self.scene["trees"][t["id"]] if not p["name"].endswith(" limbs")]
            self.assertTrue(parts and all(p["photo"] for p in parts), t["id"])
            self.assertGreater(sum(p["polys"] for p in parts), 50000, t["id"])

    def test_a_carrier_tree_has_a_limb_that_leaves_its_trunk_and_reaches_its_branch(self):
        self.assertTrue(self.carriers())
        for t in self.carriers():
            limb = self.scene["limbs"][t["id"]]
            self.assertTrue(limb, t["id"])
            for b in t["branches"]:
                gap = min(math.dist(p, q) for p in limb for q in self.scene["branches"][b])
                self.assertLessEqual(gap, 6.0, "%s: the limb does not touch %s" % (t["id"], b))
            near_trunk = min(math.hypot(p[0] - t["at_in"][0], p[1] - t["at_in"][1]) for p in limb)
            self.assertLessEqual(near_trunk, t["trunk_in"] / 2.0 + 0.5, t["id"])

    def test_a_tree_with_no_branch_has_no_limb(self):
        for t in spec()["trees"]:
            if not t["branches"]:
                self.assertNotIn(t["id"], self.scene["limbs"])


if __name__ == "__main__":
    unittest.main()
