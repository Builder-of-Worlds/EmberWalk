import copy
import math
import os
import unittest

import support
from ewscene import house, route, schema

SPECS = {name: os.path.join(support.REPO_DIR, "fixtures", "synthetic", name + "-before", "spec.json") for name in ("hero", "mobile", "apartment")}
BUILT = {}


def spec(name="hero"):
    return copy.deepcopy(support.load_json(SPECS[name]))


def built(name="hero"):
    if name not in BUILT:
        BUILT[name] = route.build(spec(name))
    return BUILT[name]


def turn(a, b):
    return abs((b - a + 180) % 360 - 180)


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    k = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / float(dx * dx + dy * dy)))
    return math.hypot(px - ax - k * dx, py - ay - k * dy)


def wall_dist(doc, p):
    return min(seg_dist(p, e["start"], e["end"]) for e in house.edges(doc))


def frames_of(parts, kind):
    return [p for p in parts["parts"] if p["kind"] == kind]


def sample(motion, frame):
    return motion["samples"][frame - 1]


def deck(doc):
    return next(s for s in doc["structures"] if s["id"] == "back-deck")


def inside(p, s, margin):
    return s["min_in"][0] + margin < p[0] < s["max_in"][0] - margin and s["min_in"][1] + margin < p[1] < s["max_in"][1] - margin


def on_deck(p, d, margin):
    return d["min_in"][0] + margin < p[0] < d["max_in"][0] - margin and d["min_in"][1] < p[1] < d["max_in"][1]


def toward_wall(doc, p):
    best = None
    for e in house.edges(doc):
        (ax, ay), (bx, by) = e["start"], e["end"]
        q = (min(max(p[0], min(ax, bx)), max(ax, bx)), min(max(p[1], min(ay, by)), max(ay, by)))
        if best is None or math.dist(p, q) < math.dist(p, best):
            best = q
    if best in [e["start"] for e in house.edges(doc)]:
        return None
    return math.degrees(math.atan2(best[0] - p[0], best[1] - p[1])) % 360


class Normal(unittest.TestCase):
    def test_the_hero_route_reads_from_its_spec(self):
        p = route.params(spec())
        self.assertEqual((p["standoff_in"], p["height_in"], p["fps"], p["width_px"], p["height_px"]), (132, 54, 15, 1920, 1080))
        self.assertTrue(10 <= p["pan_s"] <= 20)

    def test_one_sample_per_frame_in_order(self):
        motion, parts = built()
        n = motion["frame_count"]
        self.assertEqual(len(motion["samples"]), n)
        self.assertEqual([s["frame"] for s in motion["samples"]], list(range(1, n + 1)))
        for s in motion["samples"][:: 97]:
            self.assertAlmostEqual(s["t"], (s["frame"] - 1) / 15.0, places=5)
        self.assertAlmostEqual(motion["duration_s"], n / 15.0, places=6)
        self.assertEqual((parts["frame_count"], parts["fps"], parts["scene"]), (n, 15, motion["scene"]))

    def test_the_hero_walk_at_15_fps_keeps_its_length_in_seconds_with_half_the_frames(self):
        doc = spec()
        doc["route"]["fps"] = 30
        at_30, _ = route.build(doc)
        at_15, parts = built()
        self.assertEqual(at_15["fps"], 15)
        self.assertLess(abs(at_15["duration_s"] - at_30["duration_s"]), 1 / 15.0)
        self.assertLessEqual(abs(at_15["frame_count"] - at_30["frame_count"] / 2.0), 1.0)
        self.assertEqual(parts["parts"][-1]["end_frame"], at_15["frame_count"])
        self.assertEqual([p["kind"] for p in parts["parts"]], [p["kind"] for p in route.build(doc)[1]["parts"]])

    def test_a_15_fps_motion_file_and_spec_pass_their_schemas(self):
        motion, _ = built()
        self.assertEqual(motion["fps"], 15)
        self.assertEqual(schema.errors(motion, schema.load("motion")), [])
        self.assertEqual(schema.errors(spec(), schema.load("house-spec")), [])
        for bad in (12, 29.97):
            doc = spec()
            doc["route"]["fps"] = bad
            self.assertTrue(schema.errors(doc, schema.load("house-spec")), bad)

    def test_the_whole_walk_is_330_s_or_less(self):
        for name in SPECS:
            motion, _ = built(name)
            self.assertLessEqual(motion["duration_s"], route.MAX_S, name)
            self.assertLessEqual(motion["frame_count"], 9900, name)

    def test_the_motion_file_passes_its_schema_with_house_axes(self):
        motion, _ = built()
        self.assertEqual(schema.errors(motion, schema.load("motion")), [])
        self.assertIn("house axes", motion["conventions"]["pos_in"])
        self.assertEqual((motion["synthetic"], motion["label"], motion["scene"]), (True, "Synthetic sample house", "hero-before"))

    def test_the_walk_starts_and_ends_at_the_front_door(self):
        doc = spec()
        motion, _ = built()
        door = house.door_point(doc, 132)
        for s in (motion["samples"][0], motion["samples"][-1]):
            self.assertLess(math.dist(s["pos_in"][:2], door), 1.0)

    def test_parts_run_end_to_end_and_alternate_loop_and_pan(self):
        motion, parts = built()
        ps = parts["parts"]
        self.assertEqual(ps[0]["start_frame"], 1)
        self.assertEqual(ps[-1]["end_frame"], motion["frame_count"])
        for a, b in zip(ps, ps[1:]):
            self.assertEqual(b["start_frame"], a["end_frame"] + 1)
            self.assertAlmostEqual(b["start_s"], a["end_s"], places=6)
            self.assertNotEqual(a["kind"], b["kind"])
            gap = math.dist(sample(motion, a["end_frame"])["pos_in"], sample(motion, b["start_frame"])["pos_in"])
            self.assertLess(gap, 3.0)

    def test_the_pans_are_the_house_pans_in_order(self):
        doc = spec()
        _, parts = built()
        pans = frames_of(parts, "pan")
        want = house.pans(doc, 132)
        self.assertEqual(len(pans), 12)
        for got, w in zip(pans, want):
            self.assertEqual(got.get("side") or got.get("corner"), w.get("side") or w.get("sides"))
            self.assertEqual(got["bearing_deg"], w["bearing_deg"])
            self.assertAlmostEqual(got["end_s"] - got["start_s"], route.params(doc)["pan_s"], places=6)

    def test_the_loop_parts_cover_the_whole_loop_once(self):
        doc = spec()
        _, parts = built()
        walked = sum(p["loop_in"][1] - p["loop_in"][0] for p in frames_of(parts, "loop"))
        self.assertAlmostEqual(walked, house.loop_length_in(doc, 132), places=6)

    def test_the_camera_walks_at_the_standoff_facing_the_wall(self):
        doc = spec()
        motion, parts = built()
        corners = [e["start"] for e in house.loop(doc, 132)]
        checked = 0
        for p in frames_of(parts, "loop"):
            for f in range(p["start_frame"], p["end_frame"] + 1, 7):
                s = sample(motion, f)
                xy = s["pos_in"][:2]
                self.assertTrue(131 <= wall_dist(doc, xy) <= 132 * math.sqrt(2) + 1, f)
                face = toward_wall(doc, xy)
                if face is None or min(math.dist(xy, c) for c in corners) < route.TURN_IN + 4:
                    continue
                checked += 1
                self.assertAlmostEqual(wall_dist(doc, xy), 132, delta=1.0)
                self.assertLess(turn(s["heading_deg"], face), 2.5, f)
        self.assertGreater(checked * 7, 90 * route.params(doc)["fps"])

    def test_each_pan_looks_out_along_its_bearing_at_its_middle(self):
        motion, parts = built()
        for p in frames_of(parts, "pan"):
            mid = sample(motion, (p["start_frame"] + p["end_frame"]) // 2)
            self.assertLess(turn(mid["heading_deg"], p["bearing_deg"]), 3.0, p)
            self.assertAlmostEqual(mid["tilt_deg"], route.params(spec())["pan_tilt_deg"], delta=1.5)

    def test_headings_turn_smoothly_on_every_house(self):
        for name in SPECS:
            motion, _ = built(name)
            hs = [s["heading_deg"] for s in motion["samples"]]
            worst = max(turn(a, b) for a, b in zip(hs, hs[1:]))
            self.assertLessEqual(worst, route.MAX_TURN_DEG, name)

    def test_the_camera_never_enters_the_house_or_a_hazard_box(self):
        for name in SPECS:
            doc = spec(name)
            motion, _ = built(name)
            boxes = route.hazard_boxes(doc)
            eds = house.edges(doc)
            for s in motion["samples"]:
                x, y, z = s["pos_in"]
                self.assertFalse(house.overlaps_house((x - 1, y - 1, x + 1, y + 1), eds), (name, s["frame"]))
                for hid, (x0, y0, z0, x1, y1, z1) in boxes.items():
                    self.assertFalse(x0 < x < x1 and y0 < y < y1 and z0 < z < z1, (name, hid, s["frame"]))

    def test_the_route_stays_in_the_lot(self):
        for name in SPECS:
            doc = spec(name)
            motion, _ = built(name)
            lo, hi = doc["lot"]["min_in"], doc["lot"]["max_in"]
            for s in motion["samples"]:
                self.assertTrue(lo[0] <= s["pos_in"][0] <= hi[0] and lo[1] <= s["pos_in"][1] <= hi[1])

    def test_a_route_is_the_same_every_build(self):
        self.assertEqual(route.build(spec()), built())


class Deck(unittest.TestCase):
    def test_the_camera_is_78_in_on_the_deck_and_54_off_it(self):
        doc = spec()
        motion, _ = built()
        d = deck(doc)
        stride = route.stride_in(route.params(doc))
        on = off = 0
        for s in motion["samples"]:
            p = s["pos_in"]
            if on_deck(p, d, stride / 2 + 1):
                on += 1
                self.assertAlmostEqual(p[2], 78, delta=0.8)
            elif not any(inside(p, st, -stride / 2 - 1) for st in doc["structures"] if st["kind"] in route.WALKABLE):
                off += 1
                self.assertAlmostEqual(p[2], 54, delta=0.8)
        self.assertGreater(on, 10 * route.params(doc)["fps"])
        self.assertGreater(off, 100 * route.params(doc)["fps"])

    def test_the_rise_is_eased_over_one_stride_with_no_jump(self):
        doc = spec()
        motion, _ = built()
        zs = [s["pos_in"][2] for s in motion["samples"]]
        p = route.params(doc)
        self.assertLess(max(abs(b - a) for a, b in zip(zs, zs[1:])) * p["fps"], 60)
        rising = [s for s in motion["samples"] if 56 < s["pos_in"][2] < 76]
        self.assertGreaterEqual(len(rising), 2 * 0.6 * route.stride_in(p) / p["speed_in_s"] * p["fps"])

    def test_the_stride_follows_the_pace(self):
        self.assertAlmostEqual(route.stride_in({"speed_in_s": 30}), 60 / 1.8)


class Refused(unittest.TestCase):
    def assertRefused(self, doc, words):
        with self.assertRaises(house.HouseError) as e:
            route.build(doc)
        self.assertEqual(e.exception.kind, "refused")
        self.assertIn(words, str(e.exception))

    def test_a_standoff_under_120_in(self):
        doc = spec()
        doc["route"]["standoff_in"] = 119
        self.assertRefused(doc, "standoff 119 in is outside 120 to 144 in")

    def test_a_standoff_over_144_in(self):
        doc = spec()
        doc["route"]["standoff_in"] = 145
        self.assertRefused(doc, "standoff 145 in is outside 120 to 144 in")

    def test_a_pan_shorter_than_10_s(self):
        doc = spec()
        doc["route"]["pan_s"] = 9.9
        self.assertRefused(doc, "pan 9.9 s is outside 10 to 20 s")

    def test_a_pan_longer_than_20_s(self):
        doc = spec()
        doc["route"]["pan_s"] = 20.1
        self.assertRefused(doc, "pan 20.1 s is outside 10 to 20 s")

    def test_pans_of_10_and_20_s_pass_the_pan_rule(self):
        for pan in (10, 20):
            doc = spec("mobile")
            doc["route"] = {"pan_s": pan}
            motion, parts = route.build(doc)
            self.assertAlmostEqual(frames_of(parts, "pan")[0]["end_s"] - frames_of(parts, "pan")[0]["start_s"], pan)

    def test_a_route_that_leaves_the_lot(self):
        doc = spec()
        doc["lot"]["min_in"][0] = -100
        self.assertRefused(doc, "the walk leaves the lot")

    def test_a_walk_over_330_s(self):
        doc = spec()
        doc["route"]["speed_in_s"] = 12
        self.assertRefused(doc, "over 330 s")

    def test_a_hazard_box_on_the_walk(self):
        doc = spec()
        h = next(h for h in doc["hazards"] if h["id"] == "shed-right")
        h.update(distance_in=100, size_in=[60, 60, 80])
        self.assertRefused(doc, "the camera enters shed-right")

    def test_an_unknown_route_setting(self):
        doc = spec()
        doc["route"]["sprint"] = 1
        self.assertRefused(doc, "route: unknown setting sprint")


class Samples(unittest.TestCase):
    def samples(self, *poses):
        return [{"frame": i + 1, "pos_in": list(pos), "heading_deg": h} for i, (pos, h) in enumerate(poses)]

    def assertRefused(self, samples, words):
        with self.assertRaises(house.HouseError) as e:
            route.check_samples(spec(), samples)
        self.assertEqual(e.exception.kind, "refused")
        self.assertIn(words, str(e.exception))

    def test_a_turn_of_15_degrees_a_frame_passes(self):
        route.check_samples(spec(), self.samples(((-132, 400, 54), 350), ((-132, 401, 54), 5)))

    def test_a_turn_over_15_degrees_a_frame(self):
        self.assertRefused(self.samples(((-132, 400, 54), 350), ((-132, 401, 54), 5.5)), "the heading jumps more than 15 degrees at frame 2")

    def test_a_camera_inside_the_house(self):
        self.assertRefused(self.samples(((-132, 400, 54), 90), ((100, 400, 54), 90)), "the camera enters the house at frame 2")

    def test_a_camera_at_the_wall_face(self):
        self.assertRefused(self.samples(((0.5, 400, 54), 90),), "the camera enters the house at frame 1")

    def test_a_camera_inside_a_hazard_box(self):
        x0, y0, z0, x1, y1, z1 = route.hazard_boxes(spec())["shed-right"]
        self.assertRefused(self.samples((((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 90),), "the camera enters shed-right at frame 1")

    def test_a_camera_above_a_hazard_box_passes(self):
        x0, y0, z0, x1, y1, z1 = route.hazard_boxes(spec())["shed-right"]
        route.check_samples(spec(), self.samples((((x0 + x1) / 2, (y0 + y1) / 2, z1 + 1), 90),))


class Placeholder(unittest.TestCase):
    def test_a_placeholder_route_takes_the_defaults(self):
        doc = spec("mobile")
        self.assertEqual(doc["route"], {"placeholder": True})
        self.assertEqual(route.params(doc), route.DEFAULTS)


if __name__ == "__main__":
    unittest.main()
