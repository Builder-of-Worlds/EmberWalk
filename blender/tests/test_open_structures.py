import json
import os
import subprocess
import unittest

import support

PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_open_structures.py")
BLENDER = support.blender_path()


@unittest.skipUnless(BLENDER, "Blender not found: the open structures probe did not run, so this is a PARTIAL RUN")
class OpenStructures(unittest.TestCase):
    """A carport, a stair, a landing and a balcony are open frames you can see through, not solid blocks."""

    @classmethod
    def setUpClass(cls):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE],
                             capture_output=True, text=True, timeout=900)
        cls.err = run.stderr[-800:] + run.stdout[-400:]
        line = next((l for l in run.stdout.splitlines() if l.startswith("EW_OPEN ")), None)
        cls.got = json.loads(line[8:]) if line else None

    def setUp(self):
        self.assertTrue(self.got, self.err)

    def test_the_carport_is_a_roof_on_posts_with_clear_air_under_it(self):
        c = self.got["carport"]
        self.assertEqual(c["side_at_2in"], [False, False])
        self.assertTrue(c["from_above"])
        self.assertAlmostEqual(c["hi"][2], c["top"], delta=0.5)

    def test_a_metal_stair_is_treads_and_stringers_not_a_solid_mass(self):
        s = self.got["stair-steps"]
        self.assertEqual(s["side_at_2in"], [False, False])
        self.assertTrue(s["from_above"])

    def test_a_landing_and_a_balcony_are_a_slab_on_posts_with_a_rail(self):
        for sid in ("stair-landing", "balcony-back-middle"):
            g = self.got[sid]
            self.assertEqual(g["side_at_2in"], [False, False], sid)
            self.assertTrue(g["from_above"], sid)
            self.assertGreater(g["hi"][2], g["top"] + 24.0, sid)
            self.assertLessEqual(g["hi"][2], g["top"] + 48.0, sid)

    def test_a_concrete_porch_stays_a_solid_block(self):
        p = self.got["front-porch"]
        self.assertTrue(p["from_above"])
        self.assertAlmostEqual(p["hi"][2], p["top"], delta=0.5)


if __name__ == "__main__":
    unittest.main()
