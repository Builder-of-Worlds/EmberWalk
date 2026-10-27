import copy
import os
import unittest

import support
from ewscene import assets, geom, motion, probe, schema, spec as scene_spec, truth

YARD2 = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "test-yard-2")
FENCE = "fence-joint-1"
TWO_FPS = 15


def yard2(name):
    return support.load_json(os.path.join(YARD2, name))


def runs(widths):
    best = run = 0
    for w in widths:
        run = run + 1 if w >= 400 else 0
        best = max(best, run)
    return best


class Yard2Spec(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = assets.load_catalog()
        cls.spec = yard2("spec.json")
        cls.v1 = support.sample_spec()

    def test_the_spec_is_valid(self):
        scene_spec.validate(copy.deepcopy(self.spec), self.catalog)

    def test_it_differs_from_the_first_yard_only_in_the_light_the_standoff_and_the_fence(self):
        a, b = copy.deepcopy(self.v1), copy.deepcopy(self.spec)
        for doc in (a, b):
            doc["id"] = "x"
            doc["light"]["rotation_deg"] = 0
            doc["walk"]["standoff_in"] = 0
            fence = next(h for h in doc["hazards"] if h["id"] == FENCE)
            fence.update(asset="x", along_in=0, size_in=[1, 1, 1])
        self.assertEqual(a, b)

    def test_the_brush_and_the_pile_are_as_they_were(self):
        for hazard_id in ("wood-pile-1", "dry-brush-1"):
            old = next(h for h in self.v1["hazards"] if h["id"] == hazard_id)
            new = next(h for h in self.spec["hazards"] if h["id"] == hazard_id)
            self.assertEqual(old, new)

    def test_the_fence_stays_on_the_wall_and_off_the_walk(self):
        fence = next(h for h in self.spec["hazards"] if h["id"] == FENCE)
        self.assertEqual(fence["distance_in"], 0)
        self.assertLess(fence["size_in"][1], self.spec["walk"]["standoff_in"])
        self.assertGreater(fence["along_in"], self.spec["walk"]["end_along_in"])

    def test_the_first_yard_is_untouched(self):
        self.assertEqual(self.v1["id"], "test-yard")
        self.assertEqual(self.v1["light"]["rotation_deg"], -94)
        self.assertEqual(self.v1["walk"]["standoff_in"], 144)
        fence = next(h for h in self.v1["hazards"] if h["id"] == FENCE)
        self.assertEqual((fence["asset"], fence["along_in"], fence["size_in"]), ("scripted:wood_fence", 480, [4, 288, 72]))

    def test_every_tint_is_three_sane_multipliers(self):
        tinted = [e for e in self.catalog.values() if "tint" in e]
        self.assertTrue(tinted)
        for entry in tinted:
            self.assertEqual(len(entry["tint"]), 3)
            for v in entry["tint"]:
                self.assertTrue(0 < v <= 5)

    def test_a_tinted_asset_is_scripted_and_names_a_texture(self):
        for entry in self.catalog.values():
            if "tint" in entry:
                self.assertEqual(entry["kind"], "scripted")
                self.assertEqual(self.catalog[entry["material"]]["kind"], "texture")


class Yard2Files(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = yard2("spec.json")
        cls.motion = yard2("motion.json")
        cls.truth = yard2("truth.json")
        cls.render = yard2("render.json")
        cls.fence = next(h for h in cls.truth["hazards"] if h["id"] == FENCE)

    def test_motion_is_what_the_spec_makes(self):
        self.assertEqual(self.motion, motion.build(self.spec))

    def test_truth_without_boxes_is_what_the_spec_makes(self):
        plain = truth.build(self.spec, self.motion)
        body = copy.deepcopy(self.truth)
        body.pop("box_source")
        body["visible_rule"] = plain["visible_rule"]
        for mine, theirs in zip(body["hazards"], plain["hazards"]):
            mine.pop("frame_boxes")
            for key in ("visible_frames", "visible_s"):
                mine[key] = theirs[key]
        self.assertEqual(body, plain)

    def test_truth_and_render_pass_their_schemas(self):
        self.assertEqual(schema.errors(self.truth, schema.load("truth")), [])
        self.assertEqual(schema.errors(self.render, schema.load("render")), [])

    def test_the_render_matches_the_walk(self):
        self.assertEqual(probe.problems(self.render, self.motion), [])
        self.assertEqual(self.render["scene"], "test-yard-2")

    def test_every_hazard_has_one_box_per_visible_frame_and_none_elsewhere(self):
        fps = self.motion["fps"]
        for h in self.truth["hazards"]:
            with self.subTest(hazard=h["id"]):
                self.assertEqual(len(h["frame_boxes"]), h["visible_frames"])
                frames = [b["frame"] for b in h["frame_boxes"]]
                self.assertEqual(frames, sorted(set(frames)))
                inside = {f for start, end in h["visible_s"] for f in range(round(start * fps) + 1, round(end * fps) + 2)}
                self.assertEqual(set(frames), inside)
                self.assertGreaterEqual(h["visible_frames"], 60)

    def test_boxes_sit_inside_the_image_and_carry_their_time(self):
        cam = self.motion["camera"]
        for h in self.truth["hazards"]:
            for b in h["frame_boxes"]:
                left, top, right, bottom = b["box_px"]
                self.assertTrue(0 <= left < right <= cam["width_px"] and 0 <= top < bottom <= cam["height_px"], b)
                self.assertEqual(b["t"], self.motion["samples"][b["frame"] - 1]["t"])
                self.assertLessEqual(b["area_px"], (right - left) * (bottom - top))

    def test_boxes_are_tighter_than_the_projected_box(self):
        cam = self.motion["camera"]
        for h in self.truth["hazards"]:
            lo, hi = h["box_in"]["min"], h["box_in"]["max"]
            tighter = 0
            for b in h["frame_boxes"][::10]:
                pose = self.motion["samples"][b["frame"] - 1]
                uv = [geom.project((x, y, z), pose, cam) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
                if any(p is None for p in uv):
                    continue
                left, top, right, bottom = b["box_px"]
                loose = (max(0, max(p[0] for p in uv) - min(p[0] for p in uv))) * (max(p[1] for p in uv) - min(p[1] for p in uv))
                if (right - left) * (bottom - top) < loose:
                    tighter += 1
            with self.subTest(hazard=h["id"]):
                self.assertGreater(tighter, 0)

    def test_the_fence_is_400_px_wide_on_five_consecutive_two_fps_frames(self):
        by_frame = {b["frame"]: b["box_px"] for b in self.fence["frame_boxes"]}
        widths = [(by_frame[n][2] - by_frame[n][0]) if n in by_frame else 0 for n in range(1, self.motion["frame_count"] + 1, TWO_FPS)]
        self.assertGreaterEqual(runs(widths), 5)

    def test_the_fence_is_in_view_for_more_than_five_seconds(self):
        self.assertGreater(self.fence["visible_frames"] / self.motion["fps"], 5)

    def test_the_fence_is_400_px_wide_and_clear_of_the_edges_for_more_than_two_seconds(self):
        cam = self.motion["camera"]
        clear = [b for b in self.fence["frame_boxes"] if b["box_px"][2] - b["box_px"][0] >= 400
                 and b["box_px"][0] > 0 and b["box_px"][1] > 0 and b["box_px"][2] < cam["width_px"] and b["box_px"][3] < cam["height_px"]]
        self.assertGreater(len(clear) / self.motion["fps"], 2)

    def test_the_run_counter_needs_an_unbroken_run(self):
        self.assertEqual(runs([500, 500, 100, 500, 500, 500]), 3)
        self.assertEqual(runs([399, 400, 400, 400, 400, 399]), 4)
        self.assertEqual(runs([]), 0)


if __name__ == "__main__":
    unittest.main()
