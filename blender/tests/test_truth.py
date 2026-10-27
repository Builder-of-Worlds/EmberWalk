import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import motion, schema, truth


class Truth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = support.sample_spec()
        cls.motion = motion.build(cls.spec)
        cls.doc = truth.build(cls.spec, cls.motion)
        cls.by_id = {h["id"]: h for h in cls.doc["hazards"]}

    def test_distances_bands_and_contact(self):
        pile, brush, fence = self.by_id["wood-pile-1"], self.by_id["dry-brush-1"], self.by_id["fence-joint-1"]
        self.assertEqual((pile["distance_in"], pile["band"], pile["contact"]), (0, "0_5", True))
        self.assertEqual((brush["distance_in"], brush["band"], brush["contact"]), (62, "5_30", False))
        self.assertEqual(brush["distance_ft"], 5.17)
        self.assertEqual(brush["distance_text"], "5 ft 2 in")
        self.assertEqual((fence["distance_in"], fence["band"], fence["contact"]), (0, "0_5", True))

    def test_fields_carry_from_the_spec(self):
        pile = self.by_id["wood-pile-1"]
        self.assertEqual(pile["concept"], "wood pile")
        self.assertEqual(pile["side"], "back")
        self.assertEqual(pile["label"], "required_now")
        self.assertEqual(pile["rule"], "14 CCR 1299.03(a)(3)")
        self.assertEqual(pile["box_in"], {"min": [96, 0, 0], "max": [168, 18, 48]})

    def test_every_hazard_is_on_screen_for_two_seconds(self):
        fps = self.motion["fps"]
        for h in self.doc["hazards"]:
            with self.subTest(hazard=h["id"]):
                self.assertGreaterEqual(h["visible_frames"], 60)
                self.assertTrue(h["visible_s"])
                frames = sum(round((end - start) * fps) + 1 for start, end in h["visible_s"])
                self.assertEqual(frames, h["visible_frames"])
                flat = [t for w in h["visible_s"] for t in w]
                self.assertEqual(flat, sorted(flat))

    def test_leaving_the_frame_and_coming_back_makes_two_windows(self):
        spec = support.sample_spec()
        mo = motion.build(spec)
        h = spec["hazards"][1]
        seen = truth.hazard(spec, h, mo)["visible_s"]
        self.assertEqual(len(seen), 1)
        fps = mo["fps"]
        first, last = round(seen[0][0] * fps), round(seen[0][1] * fps)
        mid = (first + last) // 2
        for s in mo["samples"][mid - 5:mid + 5]:
            s["heading_deg"] = 0
        doc = truth.hazard(spec, h, mo)
        t = [s["t"] for s in mo["samples"]]
        self.assertEqual(doc["visible_s"], [[t[first], t[mid - 6]], [t[mid + 5], t[last]]])
        self.assertEqual(doc["visible_frames"], last - first + 1 - 10)

    def test_a_single_frame_is_a_window(self):
        spec = support.sample_spec()
        mo = motion.build(spec)
        h = spec["hazards"][1]
        seen = truth.hazard(spec, h, mo)["visible_s"]
        first, last = round(seen[0][0] * mo["fps"]), round(seen[0][1] * mo["fps"])
        keep = first + 3
        for i in range(first, last + 1):
            if i != keep:
                mo["samples"][i]["heading_deg"] = 0
        t = mo["samples"][keep]["t"]
        self.assertEqual(truth.hazard(spec, h, mo)["visible_s"], [[t, t]])

    def test_hazard_out_of_view_has_no_window(self):
        spec = support.sample_spec()
        spec["hazards"][0]["along_in"] = 0
        spec["hazards"][0]["size_in"] = [4, 4, 4]
        spec["walk"]["start_along_in"] = 300
        doc = truth.build(spec, motion.build(spec))
        self.assertEqual(doc["hazards"][0]["visible_frames"], 0)
        self.assertEqual(doc["hazards"][0]["visible_s"], [])
        self.assertEqual(schema.errors(doc, schema.load("truth")), [])

    def test_schema_rejects_a_bad_window(self):
        for bad in (None, [1.0, 2.0], [[1.0]], [[1.0, 2.0, 3.0]], [[-1.0, 2.0]]):
            with self.subTest(visible_s=bad):
                doc = json.loads(json.dumps(self.doc))
                doc["hazards"][0]["visible_s"] = bad
                self.assertTrue(schema.errors(doc, schema.load("truth")))

    def test_schema_and_label(self):
        self.assertEqual(schema.errors(self.doc, schema.load("truth")), [])
        self.assertTrue(self.doc["synthetic"])
        self.assertEqual(self.doc["label"], "Synthetic sample house")

    def test_schema_rejects_a_bad_band(self):
        bad = json.loads(json.dumps(self.doc))
        bad["hazards"][0]["band"] = "0_10"
        self.assertTrue(schema.errors(bad, schema.load("truth")))

    def test_committed_fixture_matches(self):
        self.assertEqual(support.fixture("truth.json"), self.doc)

    def test_dumps_round_trips(self):
        self.assertEqual(json.loads(truth.dumps(self.motion)), self.motion)
        self.assertEqual(json.loads(truth.dumps(self.doc)), self.doc)


class WriteFiles(unittest.TestCase):
    def run_cli(self, spec_path, out):
        script = os.path.join(support.BLENDER_DIR, "write_files.py")
        return subprocess.run([sys.executable, script, spec_path, "--out", out], capture_output=True, text=True)

    def test_writes_both_files(self):
        with tempfile.TemporaryDirectory() as out:
            r = self.run_cli(os.path.join(support.FIXTURE_DIR, "spec.json"), out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(out, "truth.json")) as f:
                self.assertEqual(json.load(f), support.fixture("truth.json"))
            with open(os.path.join(out, "motion.json")) as f:
                self.assertEqual(json.load(f), support.fixture("motion.json"))

    def test_refused_spec_writes_nothing(self):
        spec = support.sample_spec()
        spec["hazards"][0]["distance_in"] = -3
        with tempfile.TemporaryDirectory() as out:
            path = os.path.join(out, "spec.json")
            with open(path, "w") as f:
                json.dump(spec, f)
            r = self.run_cli(path, out)
            self.assertEqual(r.returncode, 2)
            self.assertIn("negative distance", r.stderr)
            self.assertEqual(sorted(os.listdir(out)), ["spec.json"])


if __name__ == "__main__":
    unittest.main()
