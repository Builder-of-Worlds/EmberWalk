import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import schema, truth, walled
from test_masks import make_pass

SCHEMAS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schemas")
WRITE = os.path.join(support.BLENDER_DIR, "write_files.py")
CAMERA = {"width_px": 1280, "height_px": 720, "focal_mm": 20, "sensor_width_mm": 36, "sensor_fit": "horizontal", "hfov_deg": 83.974, "vfov_deg": 53.702}


def sample(frame, x, y, heading):
    return {"frame": frame, "t": round((frame - 1) / 30, 6), "pos_in": [x, y, 54.0], "heading_deg": heading, "tilt_deg": 0.0, "roll_deg": 0.0, "shift_y": -0.118087}


def toy_lap():
    # A clockwise lap like the hero's, camera facing the house: front (going west), left, back (going east), right (going south), front again.
    legs = [((558, 108), (-200, 108), 0.0), ((-200, 108), (-200, 972), 90.0), ((-200, 972), (912, 972), 180.0),
            ((912, 972), (912, 108), 270.0), ((912, 108), (558, 108), 0.0)]
    pts = []
    for (x0, y0), (x1, y1), heading in legs:
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) // 5)
        pts += [(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, heading) for i in range(steps)]
    pts.append((558, 108, 0.0))
    samples = smooth_corners([sample(i + 1, x, y, h) for i, (x, y, h) in enumerate(pts)])
    n = len(samples)
    motion = {"schema": "emberwalk.motion/1", "synthetic": True, "label": "Synthetic sample house", "scene": "hero-before-steady", "fps": 30,
              "frame_count": n, "duration_s": round(n / 30, 3), "camera": CAMERA, "conventions": {}, "samples": samples}
    parts = {"schema": "emberwalk.route-parts/1", "synthetic": True, "label": "Synthetic sample house", "scene": "hero-before-steady", "fps": 30,
             "frame_count": n, "duration_s": round(n / 30, 3), "standoff_in": 192, "parts": [
                 {"kind": "walk", "loop_in": [0.0, 1.0], "start_s": 0.0, "end_s": 50 / 30, "start_frame": 1, "end_frame": 50},
                 {"kind": "pan", "side": "front", "bearing_deg": 180, "start_s": 50 / 30, "end_s": 60 / 30, "start_frame": 51, "end_frame": 60},
                 {"kind": "walk", "loop_in": [1.0, 2.0], "start_s": 60 / 30, "end_s": n / 30, "start_frame": 61, "end_frame": n}]}
    return motion, parts


def smooth_corners(samples):
    # The toy turns its heading at no more than one degree a frame by easing toward the side's heading.
    out = [samples[0]]
    for s in samples[1:]:
        want = s["heading_deg"]
        prev = out[-1]["heading_deg"]
        step = max(-1.0, min(1.0, walled.turn(prev, want)))
        s = dict(s, heading_deg=(prev + step) % 360)
        out.append(s)
    return out


class Obstacles(unittest.TestCase):
    def test_the_wall_and_fences_close_the_right_side_yard(self):
        ids = {o["id"] for o in walled.OBSTACLES}
        self.assertEqual(ids, {"side-yard-wall", "back-fence-east", "lot-line-fence-east"})
        for o in walled.OBSTACLES:
            self.assertGreaterEqual(o["max_in"][2], 72, o["id"])
        wall = next(o for o in walled.OBSTACLES if o["id"] == "side-yard-wall")
        back = next(o for o in walled.OBSTACLES if o["id"] == "back-fence-east")
        side = next(o for o in walled.OBSTACLES if o["id"] == "lot-line-fence-east")
        self.assertLessEqual(wall["min_in"][0], 720)
        self.assertLessEqual(back["min_in"][0], 720)
        self.assertLessEqual(side["min_in"][1], wall["max_in"][1])
        self.assertGreaterEqual(side["max_in"][1], back["min_in"][1])
        self.assertGreaterEqual(wall["max_in"][0], side["max_in"][0])

    def test_camera_side_matches_the_pipeline(self):
        self.assertEqual(walled.camera_side([-60, 400]), "left")
        self.assertEqual(walled.camera_side([400, 851]), "back")
        self.assertEqual(walled.camera_side([801, 400]), "right")
        self.assertEqual(walled.camera_side([800, 108]), "front")


class Walk(unittest.TestCase):
    def setUp(self):
        self.hero, self.hero_parts = toy_lap()
        self.motion, self.parts = walled.build(self.hero, self.hero_parts)

    def test_never_on_the_right_side_and_starts_front_ends_back(self):
        sides = [walled.camera_side(s["pos_in"]) for s in self.motion["samples"]]
        self.assertNotIn("right", sides)
        self.assertEqual(sides[0], "front")
        self.assertEqual(sides[-1], "back")

    def test_starts_facing_the_wall_and_ends_facing_the_fence(self):
        first, last = self.motion["samples"][0], self.motion["samples"][-1]
        self.assertLessEqual(walled.clearance(first["pos_in"]), 80)
        self.assertLessEqual(walled.clearance(last["pos_in"]), 80)
        self.assertEqual(first["heading_deg"], 0.0)
        self.assertAlmostEqual(last["heading_deg"], 180.0, places=3)

    def test_frames_numbered_and_timed_and_turns_steady(self):
        s = self.motion["samples"]
        self.assertEqual([x["frame"] for x in s], list(range(1, len(s) + 1)))
        self.assertEqual(self.motion["frame_count"], len(s))
        self.assertEqual(self.motion["scene"], "hero-walled")
        for a, b in zip(s, s[1:]):
            self.assertAlmostEqual(b["t"] - a["t"], 1 / 30, places=5)
            self.assertLess(abs(walled.turn(a["heading_deg"], b["heading_deg"])), walled.MAX_TURN_DEG)
            self.assertLess(sum((p - q) ** 2 for p, q in zip(a["pos_in"], b["pos_in"])) ** 0.5, 6)
        walled.check(self.motion)

    def test_check_refuses_a_walk_through_the_wall_or_on_the_right(self):
        bad = json.loads(json.dumps(self.motion))
        bad["samples"][5]["pos_in"] = [900, 324, 54]
        with self.assertRaises(ValueError):
            walled.check(bad)
        bad = json.loads(json.dumps(self.motion))
        bad["samples"][5]["pos_in"] = [1000, 600, 54]
        with self.assertRaises(ValueError):
            walled.check(bad)

    def test_parts_cover_every_frame_with_no_right_pan(self):
        parts = self.parts["parts"]
        self.assertEqual(parts[0]["start_frame"], 1)
        self.assertEqual(parts[-1]["end_frame"], self.motion["frame_count"])
        for a, b in zip(parts, parts[1:]):
            self.assertEqual(b["start_frame"], a["end_frame"] + 1)
            self.assertNotEqual(a["kind"], b["kind"])
        for p in parts:
            self.assertAlmostEqual(p["start_s"], (p["start_frame"] - 1) / 30, places=3)
            self.assertAlmostEqual(p["end_s"], p["end_frame"] / 30, places=3)
            if p["kind"] == "pan":
                self.assertNotEqual(p["side"], "right")
        self.assertEqual(self.parts["frame_count"], self.motion["frame_count"])
        self.assertEqual(self.parts["scene"], "hero-walled")
        self.assertEqual(self.parts["label"], "Synthetic sample house")


class Truth(unittest.TestCase):
    def doc(self):
        h = {"id": "x", "concept": "shed", "side": "right", "distance_in": 0, "distance_ft": 0.0, "distance_text": "0 ft 0 in", "band": "0_5", "contact": True,
             "label": "required_now", "rule": "14 CCR 1299.03(a)(3)", "rule_id": "rid", "asset": "scripted:x", "box_in": {"min": [0, 0, 0], "max": [1, 1, 1]}}
        # The hero's footprint, clockwise from the south west corner; a box is in its own wall's frame.
        footprint = [("left", [0, 0]), ("back", [0, 780]), ("right", [720, 780]), ("front", [720, 300]), ("garage_side", [360, 300]), ("garage", [360, 0])]
        return {"schema": "emberwalk.house-truth/1", "synthetic": True, "label": "Synthetic sample house", "scene": "hero-before-steady", "state": "before",
                "units": "inch", "axes": "house axes, whole inches", "footprint": [{"side": s, "start_in": p} for s, p in footprint],
                "sides": {"right": {"length_in": 480}, "left": {"length_in": 780}},
                "hazards": [dict(h, box_in={"min": [300, 0, 0], "max": [336, 12, 18]}), dict(h, id="y", side="left"),
                            dict(h, id="z", box_in={"min": [100, 18, 0], "max": [196, 54, 30]}),
                            dict(h, id="w", box_in={"min": [460, 0, 0], "max": [480, 30, 30]})]}

    SPEC_SIDES = {"x": "right", "y": "left", "z": "garage_side"}

    def test_hazards_inside_the_walled_yard_are_expected_not_measured(self):
        out = walled.mark_truth(self.doc(), self.SPEC_SIDES)
        self.assertEqual(out["scene"], "hero-walled")
        by = {h["id"]: h for h in out["hazards"]}
        self.assertIs(by["x"]["measured"], False)
        self.assertIs(by["y"]["measured"], True)
        self.assertIs(by["z"]["measured"], True, "filed under right, but it stands on the garage side, in the open")
        self.assertIs(by["w"]["measured"], True, "on the right wall but in front of the block wall")
        self.assertEqual(out["not_measured_sides"], [{"side": "right", "blocked_by": [o["id"] for o in walled.OBSTACLES]}])
        self.assertEqual(out["sides"], self.doc()["sides"])

    def test_rows_with_no_mask_carry_the_hero_boxes_at_the_same_poses(self):
        hero, hero_parts = toy_lap()
        motion, _ = walled.build(hero, hero_parts)
        source = walled.sources(motion, hero)
        n = next(i for i, f in enumerate(source) if f is not None) + 1
        hero_frame = source[n - 1]
        h = {"id": "g", "frame_boxes": [{"frame": hero_frame, "t": 0.0, "box_px": [1, 2, 3, 4], "area_px": 300},
                                        {"frame": 99999, "t": 0.0, "box_px": [1, 2, 3, 4], "area_px": 300}]}
        out = walled.carry_boxes(h, source, motion["samples"])
        self.assertEqual(out["frame_boxes"], [{"frame": n, "t": motion["samples"][n - 1]["t"], "box_px": [1, 2, 3, 4], "area_px": 300}])
        self.assertEqual(out["visible_frames"], 1)
        self.assertEqual(len(out["visible_s"]), 1)

    def test_marked_truth_passes_the_house_truth_schema(self):
        with open(os.path.join(SCHEMAS, "house-truth.schema.json"), encoding="utf-8") as f:
            house_truth = json.load(f)
        self.assertEqual(schema.errors(walled.mark_truth(self.doc(), self.SPEC_SIDES), house_truth), [])


class WriteWalledFiles(unittest.TestCase):
    def hero_dir(self, tmp):
        hero, hero_parts = toy_lap()
        doc = Truth().doc()
        doc["hazards"].append(dict(doc["hazards"][1], id="grass", side="right", box_in={"min": [200, 0, 0], "max": [260, 12, 6]},
                                   frame_boxes=[{"frame": 1, "t": 0.0, "box_px": [5, 6, 7, 8], "area_px": 2}]))
        spec = {"hazards": [{"id": h["id"], "side": Truth.SPEC_SIDES.get(h["id"], h["side"])} for h in doc["hazards"]]}
        path = os.path.join(tmp, "hero")
        os.makedirs(path)
        for name, body in (("motion.json", hero), ("parts.json", hero_parts), ("truth.json", doc), ("spec.json", spec)):
            with open(os.path.join(path, name), "w", encoding="utf-8") as f:
                json.dump(body, f)
        return path, hero, hero_parts

    def test_walled_writes_the_walk_and_a_truth_with_redrawn_and_carried_boxes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, hero, hero_parts = self.hero_dir(tmp)
            walk, parts = walled.build(hero, hero_parts)
            masked = ["x", "y", "z", "w"]
            mask_pass = dict(make_pass(walk, masked, {"x": {3, 4}}), indices={k: n for n, k in enumerate(masked, start=1)})
            boxes = os.path.join(tmp, "boxes.json")
            with open(boxes, "w", encoding="utf-8") as f:
                json.dump(mask_pass, f)
            out = os.path.join(tmp, "out")
            r = subprocess.run([sys.executable, WRITE, path, "--walled", "--out", out, "--mask-pass", boxes], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(sorted(os.listdir(out)), ["motion.json", "parts.json", "truth.json"])
            self.assertEqual(support.load_json(os.path.join(out, "motion.json")), walk)
            self.assertEqual(support.load_json(os.path.join(out, "parts.json")), parts)
            written = support.load_json(os.path.join(out, "truth.json"))
        self.assertEqual(written["scene"], "hero-walled")
        self.assertEqual(written["not_measured_sides"], [{"side": "right", "blocked_by": [o["id"] for o in walled.OBSTACLES]}])
        by = {h["id"]: h for h in written["hazards"]}
        self.assertEqual([h["id"] for h in written["hazards"]], ["x", "y", "z", "w", "grass"])
        self.assertEqual({k: h["measured"] for k, h in by.items()}, {"x": False, "y": True, "z": True, "w": True, "grass": False})
        self.assertEqual([b["frame"] for b in by["x"]["frame_boxes"]], [3, 4])
        self.assertEqual(by["y"]["frame_boxes"], [])
        n = walled.sources(walk, hero).index(1) + 1
        self.assertEqual(by["grass"]["frame_boxes"], [{"frame": n, "t": walk["samples"][n - 1]["t"], "box_px": [5, 6, 7, 8], "area_px": 2}])
        self.assertIn("grass have no mask in the scene", written["box_source"])
        self.assertEqual(schema.errors(written, support.load_json(os.path.join(SCHEMAS, "house-truth.schema.json"))), [])

    def test_without_walled_the_plain_spec_writes_exactly_as_before(self):
        with tempfile.TemporaryDirectory() as out:
            r = subprocess.run([sys.executable, WRITE, os.path.join(support.FIXTURE_DIR, "spec.json"), "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(sorted(os.listdir(out)), ["motion.json", "truth.json"])
            for name in ("motion.json", "truth.json"):
                with open(os.path.join(out, name), encoding="utf-8") as f:
                    self.assertEqual(f.read(), truth.dumps(support.fixture(name)), name)


if __name__ == "__main__":
    unittest.main()
