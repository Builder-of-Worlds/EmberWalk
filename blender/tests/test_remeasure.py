import json
import os
import subprocess
import tempfile
import time
import unittest

import support
from ewscene import geom

BLENDER = support.blender_path()
BUILD = os.path.join(support.BLENDER_DIR, "build_scene.py")
MEASURE = os.path.join(support.BLENDER_DIR, "measure_scene.py")
SPEC = os.path.join(support.FIXTURE_DIR, "spec.json")


def blender(args):
    return subprocess.run([BLENDER, "--background", "--factory-startup"] + args, capture_output=True, text=True, timeout=600)


@unittest.skipUnless(BLENDER, "Blender not found: the re-measure test did not run, so this is a PARTIAL RUN")
class Remeasure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = cls.tmp.name
        started = time.monotonic()
        r = blender(["--python-exit-code", "1", "--python", BUILD, "--", SPEC, "--out", cls.out])
        cls.build_seconds = time.monotonic() - started
        if r.returncode != 0:
            raise AssertionError("build failed: %s" % r.stderr[-2000:])
        path = os.path.join(cls.out, "measured.json")
        r = blender([os.path.join(cls.out, "scene.blend"), "--python-exit-code", "1", "--python", MEASURE, "--", "--out", path])
        if r.returncode != 0:
            raise AssertionError("measure failed: %s" % r.stderr[-2000:])
        cls.m = support.load_json(path)
        cls.truth = support.fixture("truth.json")
        cls.motion = support.fixture("motion.json")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_build_takes_under_two_minutes(self):
        self.assertLess(self.build_seconds, 120)

    def test_scene_holds_only_what_the_builder_made(self):
        objs = self.m["objects"]
        self.assertEqual([o for o in objs if o.startswith("CAMERA:")], ["CAMERA:Phone"])
        self.assertEqual({o.split(":", 1)[0] for o in objs}, {"CAMERA", "EMPTY", "MESH"})
        self.assertNotIn("MESH:Cube", objs)

    def test_measure_without_out_is_refused(self):
        r = blender([os.path.join(self.out, "scene.blend"), "--python-exit-code", "1", "--python", MEASURE, "--"])
        self.assertEqual(r.returncode, 2, r.stderr[-500:])
        self.assertIn("required: --out", r.stderr)

    def test_wall_face_is_at_zero(self):
        self.assertLessEqual(abs(self.m["wall_face_y_in"]), 1)

    def test_every_truth_distance_matches_the_scene_to_the_inch(self):
        self.assertEqual(sorted(self.m["hazards"]), sorted(h["id"] for h in self.truth["hazards"]))
        for h in self.truth["hazards"]:
            with self.subTest(hazard=h["id"]):
                measured = self.m["hazards"][h["id"]]["min"][1] - self.m["wall_face_y_in"]
                self.assertLessEqual(abs(measured - h["distance_in"]), 1, measured)

    def test_every_truth_box_matches_the_scene_to_the_inch(self):
        for h in self.truth["hazards"]:
            got = self.m["hazards"][h["id"]]
            for key in ("min", "max"):
                for axis in range(3):
                    with self.subTest(hazard=h["id"], corner=key, axis=axis):
                        self.assertLessEqual(abs(got[key][axis] - h["box_in"][key][axis]), 1)

    def test_camera_follows_the_motion_file(self):
        self.assertGreaterEqual(len(self.m["camera"]), 60)
        for pose in self.m["camera"]:
            s = self.motion["samples"][pose["frame"] - 1]
            with self.subTest(frame=pose["frame"]):
                for axis in range(3):
                    self.assertLessEqual(abs(pose["pos_in"][axis] - s["pos_in"][axis]), 0.05)
                want = geom.camera_rotation(s["heading_deg"], s["tilt_deg"], s["roll_deg"])
                for i in range(3):
                    for j in range(3):
                        self.assertAlmostEqual(pose["rotation"][i][j], want[i][j], places=3)

    def test_render_settings_match_the_motion_file(self):
        r, cam = self.m["render"], self.motion["camera"]
        self.assertEqual((r["width_px"], r["height_px"]), (1920, 1080))
        self.assertEqual((r["width_px"], r["height_px"]), (cam["width_px"], cam["height_px"]))
        self.assertEqual(r["fps"], self.motion["fps"])
        self.assertEqual(r["frame_count"], self.motion["frame_count"])
        self.assertAlmostEqual(r["focal_mm"], cam["focal_mm"])
        self.assertAlmostEqual(r["sensor_width_mm"], cam["sensor_width_mm"])
        self.assertEqual(r["sensor_fit"], "HORIZONTAL")
        self.assertEqual((r["codec"], r["container"]), ("H264", "MPEG4"))
        self.assertEqual(r["label"], "Synthetic sample house")

    def test_build_writes_the_committed_truth_and_motion(self):
        self.assertEqual(support.load_json(os.path.join(self.out, "truth.json")), self.truth)
        self.assertEqual(support.load_json(os.path.join(self.out, "motion.json")), self.motion)

    def test_scene_record_names_every_asset_and_license(self):
        rec = support.load_json(os.path.join(self.out, "scene.json"))
        self.assertTrue(rec["synthetic"])
        ids = {a["id"] for a in rec["assets"]}
        self.assertIn("polyhaven:dry_branches_medium_01", ids)
        for a in rec["assets"]:
            self.assertTrue(a["license"])

    def test_refused_spec_builds_nothing(self):
        spec = support.sample_spec()
        spec["hazards"][1]["asset"] = "polyhaven:unlisted_shrub"
        with tempfile.TemporaryDirectory() as out:
            path = os.path.join(out, "spec.json")
            with open(path, "w") as f:
                json.dump(spec, f)
            r = blender(["--python-exit-code", "1", "--python", BUILD, "--", path, "--out", os.path.join(out, "built")])
            self.assertEqual(r.returncode, 2, r.stderr[-500:])
            self.assertIn("unknown asset", r.stderr)
            self.assertFalse(os.path.exists(os.path.join(out, "built")))


if __name__ == "__main__":
    unittest.main()
