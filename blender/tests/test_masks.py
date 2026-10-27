import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import maskbox, motion, schema, truth

W, H = 64, 48


def paint(blocks, width=W, height=H):
    grid = bytearray(width * height)
    for index, (left, top, right, bottom) in blocks.items():
        for y in range(top, bottom):
            for x in range(left, right):
                grid[y * width + x] = index
    return bytes(grid)


class MaskBoxes(unittest.TestCase):
    def test_box_matches_the_mask_extent(self):
        data = paint({1: (10, 5, 30, 25), 2: (40, 30, 60, 46)})
        found = maskbox.boxes(data, W, H, {"a": 1, "b": 2})
        self.assertEqual(found["a"], {"box_px": [10, 5, 30, 25], "area_px": 400})
        self.assertEqual(found["b"], {"box_px": [40, 30, 60, 46], "area_px": 320})

    def test_box_is_the_tightest_rectangle_round_a_ragged_shape(self):
        data = bytearray(paint({1: (10, 10, 30, 12)}))
        data[40 * W + 55] = 1
        data[2 * W + 3] = 1
        box = maskbox.extent(maskbox.rows(bytes(data), W, H), 1)
        self.assertEqual(box["box_px"], [3, 2, 56, 41])
        self.assertEqual(box["area_px"], 42)

    def test_a_shape_with_a_gap_keeps_one_box(self):
        data = paint({1: (5, 5, 15, 25), 2: (0, 0, 1, 1)})
        data = bytearray(data)
        for y in range(5, 25):
            data[y * W + 9] = 0
        data = bytes(data)
        self.assertEqual(maskbox.extent(maskbox.rows(data, W, H), 1)["box_px"], [5, 5, 15, 25])

    def test_a_one_pixel_mask_is_a_whole_mask(self):
        self.assertEqual(maskbox.rows(b"\x01", 1, 1), [b"\x01"])
        self.assertEqual(maskbox.extent(maskbox.rows(b"\x01", 1, 1), 1), {"box_px": [0, 0, 1, 1], "area_px": 1})

    def test_a_hazard_out_of_view_has_no_box(self):
        data = paint({1: (10, 5, 30, 25)})
        found = maskbox.boxes(data, W, H, {"a": 1, "b": 2})
        self.assertIsNotNone(found["a"])
        self.assertIsNone(found["b"])

    def test_a_speck_under_the_minimum_is_not_a_box(self):
        data = paint({1: (10, 5, 15, 9)})
        self.assertEqual(maskbox.extent(maskbox.rows(data, W, H), 1)["area_px"], 20)
        self.assertIsNone(maskbox.boxes(data, W, H, {"a": 1})["a"])

    def test_a_box_cut_by_the_frame_edge_reaches_the_edge(self):
        data = paint({1: (0, 20, 30, 48)})
        self.assertEqual(maskbox.boxes(data, W, H, {"a": 1})["a"]["box_px"], [0, 20, 30, 48])

    def test_a_malformed_pass_is_refused(self):
        good = paint({1: (10, 5, 30, 25)})
        for label, data, w, h in (
            ("short", good[:-1], W, H),
            ("long", good + b"\x00", W, H),
            ("not bytes", [0] * (W * H), W, H),
            ("no width", good, 0, H),
            ("wrong shape", good, W + 1, H),
            ("empty with no width", b"", 0, H),
            ("empty with no height", b"", W, 0),
            ("empty with neither", b"", 0, 0),
        ):
            with self.subTest(label):
                with self.assertRaises(maskbox.MaskError):
                    maskbox.boxes(data, w, h, {"a": 1})


class Levels(unittest.TestCase):
    def test_a_level_is_the_linear_value_of_its_grey(self):
        self.assertAlmostEqual(maskbox.level_to_linear(1), 0.04518, places=4)
        self.assertAlmostEqual(maskbox.level_to_linear(4), 0.8714, places=3)

    def test_each_level_encodes_back_to_its_grey_and_classifies_to_its_index(self):
        for index in (1, 2, 3, 4):
            linear = maskbox.level_to_linear(index)
            grey = round(255 * (1.055 * linear ** (1 / 2.4) - 0.055))
            self.assertEqual(grey, index * maskbox.LEVEL_STEP)
            self.assertEqual(maskbox.index_of(grey), index)

    def test_a_grey_within_half_a_step_still_classifies_and_black_is_nothing(self):
        self.assertEqual(maskbox.index_of(0), 0)
        self.assertEqual(maskbox.index_of(29), 0)
        self.assertEqual(maskbox.index_of(31), 1)
        self.assertEqual(maskbox.index_of(89), 1)
        self.assertEqual(maskbox.index_of(91), 2)


def make_pass(walk, ids, visible, box=(100, 200, 400, 300), area=20000):
    frames = []
    for n in range(1, walk["frame_count"] + 1):
        boxes = {i: ({"box_px": list(box), "area_px": area} if n in visible.get(i, ()) else None) for i in ids}
        frames.append({"frame": n, "boxes": boxes})
    cam = walk["camera"]
    return {"schema": truth.PASS_SCHEMA, "width": cam["width_px"], "height": cam["height_px"], "frames": frames}


class AttachBoxes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = support.sample_spec()
        cls.walk = motion.build(cls.spec)
        cls.doc = truth.build(cls.spec, cls.walk)
        cls.ids = [h["id"] for h in cls.doc["hazards"]]

    def attach(self, mask_pass):
        return truth.attach_boxes(self.doc, mask_pass, self.walk)

    def test_boxes_come_from_the_pass_frame_by_frame(self):
        visible = {"wood-pile-1": set(range(1, 11)), "dry-brush-1": set(range(100, 104)) | {200}}
        out = self.attach(make_pass(self.walk, self.ids, visible))
        pile = next(h for h in out["hazards"] if h["id"] == "wood-pile-1")
        self.assertEqual([b["frame"] for b in pile["frame_boxes"]], list(range(1, 11)))
        self.assertEqual(pile["frame_boxes"][0], {"frame": 1, "t": 0.0, "box_px": [100, 200, 400, 300], "area_px": 20000})
        brush = next(h for h in out["hazards"] if h["id"] == "dry-brush-1")
        self.assertEqual(brush["visible_frames"], 5)
        t = [s["t"] for s in self.walk["samples"]]
        self.assertEqual(brush["visible_s"], [[t[99], t[102]], [t[199], t[199]]])
        self.assertEqual(schema.errors(out, schema.load("truth")), [])

    def test_a_hazard_never_in_the_pass_has_no_boxes_and_no_window(self):
        out = self.attach(make_pass(self.walk, self.ids, {"wood-pile-1": {1}}))
        fence = next(h for h in out["hazards"] if h["id"] == "fence-joint-1")
        self.assertEqual((fence["frame_boxes"], fence["visible_frames"], fence["visible_s"]), ([], 0, []))
        self.assertEqual(schema.errors(out, schema.load("truth")), [])

    def test_the_input_document_is_not_changed(self):
        before = copy.deepcopy(self.doc)
        self.attach(make_pass(self.walk, self.ids, {"wood-pile-1": {1}}))
        self.assertEqual(self.doc, before)

    def test_the_rule_and_source_say_the_boxes_are_from_the_mask(self):
        out = self.attach(make_pass(self.walk, self.ids, {}))
        self.assertIn("mask pass", out["visible_rule"])
        self.assertIn("flat colour pass", out["box_source"])

    def refused(self, mask_pass, text):
        with self.assertRaises(truth.MaskPassError) as caught:
            self.attach(mask_pass)
        self.assertIn(text, str(caught.exception))

    def good(self):
        return make_pass(self.walk, self.ids, {"wood-pile-1": {5}})

    def test_a_pass_of_the_wrong_kind_is_refused(self):
        bad = self.good()
        bad["schema"] = "emberwalk.other/1"
        self.refused(bad, "not an emberwalk.mask-pass/1")
        self.refused(["frames"], "not an emberwalk.mask-pass/1")

    def test_a_pass_of_the_wrong_size_is_refused(self):
        bad = self.good()
        bad["width"] = 1280
        self.refused(bad, "pass is 1280x1080")

    def test_a_missing_or_repeated_frame_is_refused(self):
        bad = self.good()
        del bad["frames"][10]
        self.refused(bad, "frames must run 1 to 600")
        bad = self.good()
        bad["frames"][10]["frame"] = 10
        self.refused(bad, "frames must run 1 to 600")
        bad = self.good()
        bad["frames"] = None
        self.refused(bad, "frames must run 1 to 600")

    def test_a_pass_naming_the_wrong_hazards_is_refused(self):
        bad = self.good()
        bad["frames"][3]["boxes"]["ghost"] = None
        self.refused(bad, "frame 4: boxes must name exactly")
        bad = self.good()
        del bad["frames"][3]["boxes"]["fence-joint-1"]
        self.refused(bad, "frame 4: boxes must name exactly")

    def test_a_box_outside_the_image_or_empty_is_refused(self):
        for label, box in (
            ("past the right edge", [100, 200, 1921, 300]),
            ("past the bottom", [100, 200, 400, 1081]),
            ("negative", [-1, 200, 400, 300]),
            ("zero width", [100, 200, 100, 300]),
            ("inverted", [400, 200, 100, 300]),
            ("three numbers", [100, 200, 400]),
            ("fractions", [100.5, 200, 400, 300]),
            ("booleans", [True, 200, 400, 300]),
        ):
            with self.subTest(label):
                bad = self.good()
                bad["frames"][4]["boxes"]["wood-pile-1"]["box_px"] = box
                self.refused(bad, "frame 5, wood-pile-1")

    def test_an_area_the_box_cannot_hold_is_refused(self):
        for area in (0, 5, 300 * 100 + 1, 1.5, True, None):
            with self.subTest(area=area):
                bad = self.good()
                bad["frames"][4]["boxes"]["wood-pile-1"]["area_px"] = area
                self.refused(bad, "area_px")

    def test_a_box_without_its_fields_is_refused(self):
        bad = self.good()
        bad["frames"][4]["boxes"]["wood-pile-1"] = {"area_px": 20000}
        self.refused(bad, "box_px must be four whole numbers")
        bad["frames"][4]["boxes"]["wood-pile-1"] = "box"
        self.refused(bad, "box_px must be four whole numbers")


class WriteWithBoxes(unittest.TestCase):
    def run_cli(self, pass_path, out):
        script = os.path.join(support.BLENDER_DIR, "write_files.py")
        spec = os.path.join(support.FIXTURE_DIR, "spec.json")
        return subprocess.run([sys.executable, script, spec, "--out", out, "--mask-pass", pass_path], capture_output=True, text=True)

    def test_a_good_pass_lands_in_truth_json(self):
        walk = motion.build(support.sample_spec())
        ids = [h["id"] for h in support.sample_spec()["hazards"]]
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "boxes.json")
            with open(path, "w") as f:
                json.dump(make_pass(walk, ids, {"wood-pile-1": {7}}), f)
            out = os.path.join(tmp, "out")
            r = self.run_cli(path, out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(out, "truth.json")) as f:
                doc = json.load(f)
        self.assertEqual(doc["hazards"][0]["frame_boxes"][0]["frame"], 7)

    def test_a_bad_pass_is_refused_and_writes_nothing(self):
        walk = motion.build(support.sample_spec())
        ids = [h["id"] for h in support.sample_spec()["hazards"]]
        bad = make_pass(walk, ids, {"wood-pile-1": {7}})
        bad["frames"][6]["boxes"]["wood-pile-1"]["box_px"] = [0, 0, 5000, 5]
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "boxes.json")
            with open(path, "w") as f:
                json.dump(bad, f)
            out = os.path.join(tmp, "out")
            r = self.run_cli(path, out)
            self.assertEqual(r.returncode, 3)
            self.assertIn("EW_ERROR mask pass", r.stderr)
            self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main()
