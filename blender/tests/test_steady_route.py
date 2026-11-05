import math
import os
import unittest

import support
from ewscene import assets, house, route, schema

SYNTHETIC = os.path.join(support.REPO_DIR, "fixtures", "synthetic")
STEADY = {"standoff_in": 144, "focal_mm": 22, "fps": 30, "pan_s": 14}
MAX_TURN_DEG = 1.7
BUILT = {}


def spec_of(name):
    return support.load_json(os.path.join(SYNTHETIC, name + "-before", "spec.json"))


def steady_spec(name):
    spec = spec_of(name)
    spec["route"]["steady"] = dict(STEADY)
    return spec


def built(name):
    if name not in BUILT:
        BUILT[name] = route.build(steady_spec(name))
    return BUILT[name]


def turns(samples):
    return [abs((b["heading_deg"] - a["heading_deg"] + 180) % 360 - 180) for a, b in zip(samples, samples[1:])]


class SteadyRoute(unittest.TestCase):
    def test_the_old_mode_still_builds_each_committed_walk(self):
        for name in ("mobile", "apartment", "hero"):
            with self.subTest(name):
                motion, parts = route.build(spec_of(name))
                self.assertEqual(motion, support.load_json(os.path.join(SYNTHETIC, name + "-before", "motion.json")))
                self.assertEqual(parts, support.load_json(os.path.join(SYNTHETIC, name + "-before", "parts.json")))

    def test_a_steady_walk_is_the_second_lap_with_every_pan_and_no_first_loop(self):
        for name in ("mobile", "apartment", "hero"):
            with self.subTest(name):
                _, parts = built(name)
                kinds = [p["kind"] for p in parts["parts"]]
                self.assertNotIn("loop", kinds)
                self.assertEqual(kinds[0], "walk")
                self.assertEqual(parts["parts"][0]["start_frame"], 1)
                self.assertEqual(sorted(p["side"] for p in parts["parts"] if p["kind"] == "pan"), ["back", "front", "left", "right"])

    def test_a_steady_walk_never_turns_faster_than_the_limit(self):
        for name in ("mobile", "apartment", "hero"):
            with self.subTest(name):
                motion, _ = built(name)
                self.assertLessEqual(max(turns(motion["samples"])), MAX_TURN_DEG)

    def test_a_path_turning_faster_than_the_limit_is_refused(self):
        samples = [{"frame": n + 1, "heading_deg": (n * 3.375) % 360} for n in range(10)]
        with self.assertRaisesRegex(house.HouseError, "frame 1 .*3.375"):
            route.check_steady_turns(samples)

    def test_a_steady_walk_may_stand_192_in_back_and_still_turns_under_the_limit(self):
        spec = steady_spec("hero")
        spec["route"]["steady"].update(standoff_in=192, focal_mm=20)
        motion, parts = route.build(spec)
        self.assertEqual(parts["standoff_in"], 192)
        self.assertEqual(motion["frame_count"], 6441)
        route.check_steady_turns(motion["samples"])

    def test_a_normal_walk_still_refuses_a_standoff_past_144(self):
        spec = spec_of("hero")
        spec["route"]["standoff_in"] = 192
        with self.assertRaises(house.HouseError):
            house.validate(spec, assets.load_catalog(), house.load_rules())

    def test_a_level_walk_keeps_the_camera_upright_and_moves_the_view_by_lens_shift(self):
        spec = steady_spec("hero")
        spec["route"]["steady"]["level"] = True
        level, _ = route.build(spec)
        aimed, _ = built("hero")
        for a, b in zip(level["samples"], aimed["samples"]):
            self.assertEqual(a["tilt_deg"], 0)
            self.assertEqual(a["roll_deg"], 0)
            self.assertEqual(a["pos_in"], b["pos_in"])
            self.assertEqual(a["heading_deg"], b["heading_deg"])
            want = -math.tan(math.radians(b["tilt_deg"])) * 22 / 36
            self.assertAlmostEqual(a["shift_y"], want, places=5)

    def test_a_walk_without_level_has_no_shift(self):
        self.assertNotIn("shift_y", built("hero")[0]["samples"][0])

    def test_the_house_and_motion_schemas_take_a_level_walk_192_in_back(self):
        spec = steady_spec("hero")
        spec["route"]["steady"].update(standoff_in=192, focal_mm=20, level=True)
        house.validate(spec, assets.load_catalog(), house.load_rules())
        self.assertEqual(schema.errors(route.build(spec)[0], schema.load("motion")), [])

    def test_a_turn_across_north_is_measured_the_short_way(self):
        route.check_steady_turns([{"frame": 1, "heading_deg": 359.5}, {"frame": 2, "heading_deg": 0.5}])

    def test_each_steady_walk_passes_the_turn_check(self):
        for name in ("mobile", "apartment", "hero"):
            with self.subTest(name):
                route.check_steady_turns(built(name)[0]["samples"])

    def test_a_steady_walk_has_no_step_bob_sway_or_roll(self):
        motion, _ = built("mobile")
        samples = motion["samples"]
        self.assertTrue(all(s["roll_deg"] == 0 for s in samples))
        along = [s for s, p in zip(samples, samples[1:]) if s["pos_in"][:2] != p["pos_in"][:2]]
        self.assertLess(max(abs(a["tilt_deg"] - b["tilt_deg"]) for a, b in zip(along, along[1:])), 0.2)
        self.assertLess(max(abs(a["pos_in"][2] - b["pos_in"][2]) for a, b in zip(along, along[1:])), 0.5)

    def test_steady_settings_reach_the_motion_file(self):
        motion, parts = built("hero")
        self.assertEqual(motion["fps"], 30)
        self.assertEqual(motion["camera"]["focal_mm"], 22)
        self.assertEqual(parts["standoff_in"], 144)
        self.assertEqual(motion["samples"][0]["t"], 0)

    def test_the_steady_block_leaves_the_scene_settings_alone(self):
        self.assertEqual(route.params(steady_spec("mobile"))["standoff_in"], route.params(spec_of("mobile"))["standoff_in"])
        self.assertEqual(route.ground_cover(steady_spec("mobile")), route.ground_cover(spec_of("mobile")))

    def test_the_house_check_accepts_a_steady_spec(self):
        house.validate(steady_spec("mobile"), assets.load_catalog(), house.load_rules())

    def test_a_steady_block_missing_a_setting_is_refused(self):
        spec = steady_spec("mobile")
        del spec["route"]["steady"]["fps"]
        with self.assertRaises(house.HouseError):
            route.build(spec)

    def test_a_standoff_outside_the_route_limits_is_refused(self):
        spec = steady_spec("mobile")
        spec["route"]["steady"]["standoff_in"] = 200
        with self.assertRaises(house.HouseError):
            route.build(spec)


if __name__ == "__main__":
    unittest.main()
