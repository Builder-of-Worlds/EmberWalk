import os
import subprocess
import tempfile
import unittest

import support
from ewscene import geom, motion, truth

BLENDER = support.blender_path()
BUILD = os.path.join(support.BLENDER_DIR, "build_scene.py")
MASKS = os.path.join(support.BLENDER_DIR, "render_masks.py")
MEASURE = os.path.join(support.BLENDER_DIR, "measure_scene.py")
SPEC = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "test-yard-2", "spec.json")
STEP = 150
SLACK_PX = 3


def blender(args):
    return subprocess.run([BLENDER, "--background", "--factory-startup"] + args, capture_output=True, text=True, timeout=900)


def loose_rect(box_in, pose, cam):
    lo, hi = box_in["min"], box_in["max"]
    uv = [geom.project((x, y, z), pose, cam) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    if any(p is None for p in uv):
        return None
    us, vs = [p[0] for p in uv], [p[1] for p in uv]
    return min(us), min(vs), max(us), max(vs)


def clipped(rect, cam):
    return max(0, rect[0]), max(0, rect[1]), min(cam["width_px"], rect[2]), min(cam["height_px"], rect[3])


def off_screen(rect, cam):
    return rect[2] <= 0 or rect[0] >= cam["width_px"] or rect[3] <= 0 or rect[1] >= cam["height_px"]


@unittest.skipUnless(BLENDER, "Blender not found: the mask render test did not run, so this is a PARTIAL RUN")
class MaskRender(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        r = blender(["--python-exit-code", "1", "--python", BUILD, "--", SPEC, "--out", cls.tmp.name])
        if r.returncode != 0:
            raise AssertionError("build failed: %s" % r.stderr[-2000:])
        cls.blend = os.path.join(cls.tmp.name, "scene.blend")
        cls.out = os.path.join(cls.tmp.name, "boxes.json")
        r = blender([cls.blend, "--python-exit-code", "1", "--python", MASKS, "--", "--out", cls.out, "--every", str(STEP)])
        if r.returncode != 0:
            raise AssertionError("mask pass failed: %s" % r.stderr[-2000:])
        cls.found = support.load_json(cls.out)
        cls.spec = support.load_json(SPEC)
        cls.walk = motion.build(cls.spec)
        cls.truth = truth.build(cls.spec, cls.walk)

        cls.measured_path = os.path.join(cls.tmp.name, "measured.json")
        r = blender([cls.blend, "--python-exit-code", "1", "--python", MEASURE, "--", "--out", cls.measured_path])
        if r.returncode != 0:
            raise AssertionError("measure failed: %s" % r.stderr[-2000:])
        cls.measured = support.load_json(cls.measured_path)

    def test_the_fence_has_its_own_tinted_material_and_the_pile_the_plain_one(self):
        used = self.measured["hazard_materials"]
        self.assertEqual(used["fence-joint-1"], ["weathered_planks tinted"])
        self.assertEqual(used["wood-pile-1"], ["bark_brown_02"])
        tint = support.load_json(os.path.join(support.BLENDER_DIR, "assets.json"))["scripted:wood_picket_fence"]["tint"]
        self.assertEqual(self.measured["materials"]["weathered_planks tinted"]["tints"], [tint])
        self.assertEqual(self.measured["materials"]["bark_brown_02"]["tints"], [])

    def test_colour_maps_are_srgb_and_the_rest_are_data(self):
        for name, mat in self.measured["materials"].items():
            with self.subTest(material=name):
                spaces = sorted(mat["images"].values())
                self.assertEqual(spaces, ["Non-Color", "Non-Color", "sRGB"])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_pass_covers_the_asked_frames_and_every_hazard(self):
        self.assertEqual([f["frame"] for f in self.found["frames"]], list(range(1, 601, STEP)))
        ids = {h["id"] for h in self.truth["hazards"]}
        for f in self.found["frames"]:
            self.assertEqual(set(f["boxes"]), ids)
        self.assertEqual((self.found["width"], self.found["height"]), (1920, 1080))

    def test_some_hazard_shows_in_some_frame(self):
        shown = [hit for f in self.found["frames"] for hit in f["boxes"].values() if hit]
        self.assertGreaterEqual(len(shown), 3)

    def test_every_box_lies_inside_the_projected_box_and_is_tighter(self):
        cam = self.walk["camera"]
        checked = 0
        for f in self.found["frames"]:
            pose = self.walk["samples"][f["frame"] - 1]
            for h in self.truth["hazards"]:
                hit = f["boxes"][h["id"]]
                loose = loose_rect(h["box_in"], pose, cam)
                if hit is None or loose is None:
                    continue
                loose = clipped(loose, cam)
                with self.subTest(frame=f["frame"], hazard=h["id"]):
                    left, top, right, bottom = hit["box_px"]
                    self.assertGreaterEqual(left, loose[0] - SLACK_PX)
                    self.assertGreaterEqual(top, loose[1] - SLACK_PX)
                    self.assertLessEqual(right, loose[2] + SLACK_PX)
                    self.assertLessEqual(bottom, loose[3] + SLACK_PX)
                    self.assertLess((right - left) * (bottom - top), (loose[2] - loose[0]) * (loose[3] - loose[1]))
                    self.assertLessEqual(hit["area_px"], (right - left) * (bottom - top))
                    checked += 1
        self.assertGreaterEqual(checked, 3)

    def test_a_hazard_whose_projected_box_is_off_screen_has_no_box(self):
        cam = self.walk["camera"]
        for f in self.found["frames"]:
            pose = self.walk["samples"][f["frame"] - 1]
            for h in self.truth["hazards"]:
                loose = loose_rect(h["box_in"], pose, cam)
                if loose is not None and off_screen(loose, cam):
                    with self.subTest(frame=f["frame"], hazard=h["id"]):
                        self.assertIsNone(f["boxes"][h["id"]])

    def test_a_partial_pass_is_refused_by_the_truth_writer(self):
        with self.assertRaises(truth.MaskPassError):
            truth.attach_boxes(self.truth, self.found, self.walk)

    def test_a_run_without_out_is_refused(self):
        r = blender([self.blend, "--python-exit-code", "1", "--python", MASKS, "--"])
        self.assertEqual(r.returncode, 2, r.stderr[-500:])
        self.assertIn("required: --out", r.stderr)


if __name__ == "__main__":
    unittest.main()
