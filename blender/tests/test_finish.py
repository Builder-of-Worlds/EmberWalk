import hashlib
import json
import os
import subprocess
import unittest

import support

PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_finish.py")
BLENDER = support.blender_path()
FIXTURES = os.path.join(support.REPO_DIR, "fixtures", "synthetic")

# The approved hero walk. Its files change only on the owner's word; then these hashes change with it.
HERO_FILES = {
    "hero-before/mix.json": "641e71c00cc289d1314fa4960d8d521939e79908bf06c355be4f1d2f11bd7fbe",
    "hero-before/motion.json": "d959288b20f1bbe2c7f42f540df1329ed465fdba1af8944899f05c9e53e53def",
    "hero-before/parts.json": "6720345457df9ae72a41c2bc79e5451274de96020f0e97c8f6b1879d0927399b",
    "hero-before/render.json": "d0a3d0d33d300c63953b45d25521ad5087be3b620d904710aead76917c22ee30",
    "hero-before/spec.json": "6e765b6cd5dccb94fb8c428f91173b6090416e91ed77d942fc9500c322d144fa",
    "hero-before/truth.json": "9c53c72bff9b5913cb0f5189d0da397bc82896b59ab2bfbca5080f7a736a08c1",
    "hero-after/changes.json": "0d0d169a06fa82d5d56c45efe55cf2ea1e3993691a199515ddb53b51230e89e0",
    "hero-after/motion.json": "a707b2ea8730cfe6812c82c45cf1f757fe282def12b1c7f89505153bedf79d9e",
    "hero-after/parts.json": "d627132689acbbebcf70c82798fb1da1780efdddb14eed650502daa739717532",
    "hero-after/recheck.json": "cbb19f79962ad5d9306a99dc8d0c8593aff9abab04d35fdea629e15e81cc6c49",
    "hero-after/render.json": "c85b63ae0a9bdba6a3d58810a452ba5039be953fceb1484d46ac2579e136fce8",
    "hero-after/truth.json": "eb81aae35549eade54006973b911eee041cd8ff41fea10d0ee9f3788667eb0e7",
}


def probe(house):
    run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE, "--", house],
                         capture_output=True, text=True, timeout=900)
    line = next((l for l in run.stdout.splitlines() if l.startswith("EW_FINISH ")), None)
    return json.loads(line[10:]) if line else None, run.stderr[-800:] + run.stdout[-400:]


class HeroFilesAreUntouched(unittest.TestCase):
    def test_every_hero_fixture_is_byte_identical_to_the_approved_walk(self):
        for rel, want in HERO_FILES.items():
            with open(os.path.join(FIXTURES, rel), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), want, rel)

    def test_the_hero_spec_asks_for_no_finish_so_it_keeps_the_approved_one(self):
        self.assertNotIn("finish", support.load_json(os.path.join(FIXTURES, "hero-before", "spec.json"))["look"])

    def test_mobile_and_apartment_ask_for_finish_2(self):
        for name in ("mobile-before", "apartment-before"):
            self.assertEqual(support.load_json(os.path.join(FIXTURES, name, "spec.json"))["look"]["finish"], 2, name)


@unittest.skipUnless(BLENDER, "Blender not found: the finish probe did not run, so this is a PARTIAL RUN")
class FinishInTheScene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hero, cls.hero_err = probe("hero")
        cls.mobile, cls.mobile_err = probe("mobile")

    def test_the_hero_scene_keeps_light_window_rooms_black_bins_and_the_original_grass(self):
        self.assertTrue(self.hero, self.hero_err)
        self.assertEqual(self.hero["finish"], 1)
        self.assertEqual(self.hero["rooms"], ["Window room"])
        self.assertTrue(self.hero["bins"])
        for tag, colours in self.hero["bins"].items():
            self.assertTrue(colours and all(max(c) < 0.02 for c in colours), (tag, colours))
        self.assertTrue(self.hero["grass"])
        for tag, polys in self.hero["grass"].items():
            w, d, _ = self.hero["grass_sizes"][tag]
            self.assertEqual(polys, 9 * max(1, int(w // 7)) * max(1, int(d // 7)), tag)

    def test_the_mobile_scene_gets_dark_rooms_green_bins_and_thinner_clumped_grass(self):
        self.assertTrue(self.mobile, self.mobile_err)
        self.assertEqual(self.mobile["finish"], 2)
        self.assertEqual(self.mobile["rooms"], ["Window room dark"])
        for tag, colours in self.mobile["bins"].items():
            self.assertTrue(colours and all(c[1] > 0.05 and c[1] > c[0] for c in colours), (tag, colours))
        self.assertTrue(self.mobile["grass"])
        for tag, polys in self.mobile["grass"].items():
            w, d, _ = self.mobile["grass_sizes"][tag]
            self.assertLess(polys, 9 * max(1, int(w // 7)) * max(1, int(d // 7)), tag)
            self.assertGreater(polys, 60, tag)


if __name__ == "__main__":
    unittest.main()
