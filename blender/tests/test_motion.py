import math
import unittest

import support
from ewscene import geom, motion, schema


def view_dir(sample):
    return geom.apply(geom.camera_rotation(sample["heading_deg"], sample["tilt_deg"], sample["roll_deg"]), (0, 0, -1))


class Rotation(unittest.TestCase):
    def test_heading_180_faces_the_wall(self):
        d = view_dir({"heading_deg": 180, "tilt_deg": 0, "roll_deg": 0})
        for got, want in zip(d, (0, -1, 0)):
            self.assertAlmostEqual(got, want)

    def test_heading_90_faces_along_the_wall(self):
        d = view_dir({"heading_deg": 90, "tilt_deg": 0, "roll_deg": 0})
        for got, want in zip(d, (1, 0, 0)):
            self.assertAlmostEqual(got, want)

    def test_tilt_looks_down(self):
        d = view_dir({"heading_deg": 180, "tilt_deg": 30, "roll_deg": 0})
        self.assertAlmostEqual(d[2], -0.5)

    def test_roll_turns_the_top_to_the_right(self):
        up = geom.apply(geom.camera_rotation(180, 0, 10), (0, 1, 0))
        right = geom.apply(geom.camera_rotation(180, 0, 0), (1, 0, 0))
        self.assertGreater(sum(a * b for a, b in zip(up, right)), 0.1)

    def test_rotation_is_orthonormal(self):
        r = geom.camera_rotation(137, 21, -4)
        p = geom.matmul(r, geom.transpose(r))
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(p[i][j], 1.0 if i == j else 0.0)


class Projection(unittest.TestCase):
    CAM = {"width_px": 1920, "height_px": 1080, "focal_mm": 26, "sensor_width_mm": 36}
    POSE = {"pos_in": [0, 100, 50], "heading_deg": 180, "tilt_deg": 0, "roll_deg": 0}

    def test_point_ahead_is_centred(self):
        u, v = geom.project((0, 0, 50), self.POSE, self.CAM)
        self.assertAlmostEqual(u, 960)
        self.assertAlmostEqual(v, 540)

    def test_point_to_the_right_and_low(self):
        u, v = geom.project((-10, 0, 40), self.POSE, self.CAM)
        self.assertGreater(u, 960)
        self.assertGreater(v, 540)

    def test_x_runs_right_to_left_as_seen_from_the_yard(self):
        u, _ = geom.project((10, 0, 50), self.POSE, self.CAM)
        self.assertLess(u, 960)
        self.assertIn("right end as seen from the yard", motion.CONVENTIONS["pos_in"])

    def test_point_behind_is_none(self):
        self.assertIsNone(geom.project((0, 200, 50), self.POSE, self.CAM))

    def test_field_of_view(self):
        h, v = geom.fov_deg(self.CAM)
        self.assertAlmostEqual(h, 69.39, places=2)
        self.assertAlmostEqual(v, 42.55, places=2)


class Walk(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = support.sample_spec()
        cls.doc = motion.build(cls.spec)
        cls.samples = cls.doc["samples"]

    def test_frames_and_timestamps(self):
        self.assertEqual(self.doc["frame_count"], 600)
        self.assertEqual(len(self.samples), 600)
        self.assertEqual(self.samples[0]["frame"], 1)
        self.assertEqual(self.samples[-1]["frame"], 600)
        for a, b in zip(self.samples, self.samples[1:]):
            self.assertAlmostEqual(b["t"] - a["t"], 1 / 30, places=4)

    def test_walk_runs_from_start_to_end(self):
        self.assertAlmostEqual(self.samples[0]["pos_in"][0], 72, places=1)
        self.assertAlmostEqual(self.samples[-1]["pos_in"][0], 408, places=1)

    def test_phone_stays_near_chest_height_and_standoff(self):
        for s in self.samples:
            self.assertLess(abs(s["pos_in"][2] - 54), 1.0)
            self.assertLess(abs(s["pos_in"][1] - 144), 1.0)
            self.assertLess(abs(s["tilt_deg"] - 17), 2.0)
            self.assertLess(abs(s["heading_deg"] - 180), 3.0)
            self.assertLess(abs(s["roll_deg"]), 2.0)

    def test_walking_pace_and_no_jumps(self):
        fps = self.doc["fps"]
        for a, b in zip(self.samples, self.samples[1:]):
            step = math.dist(a["pos_in"], b["pos_in"])
            self.assertLess(step * fps, 48)
            self.assertLess(abs(b["heading_deg"] - a["heading_deg"]), 0.5)

    def test_handheld_sway_is_present(self):
        mid = self.samples[250:350]
        self.assertGreater(max(s["pos_in"][2] for s in mid) - min(s["pos_in"][2] for s in mid), 0.8)
        self.assertGreater(max(s["roll_deg"] for s in mid) - min(s["roll_deg"] for s in mid), 0.3)

    def test_still_at_both_ends(self):
        a, b = self.samples[0]["pos_in"], self.samples[1]["pos_in"]
        self.assertLess(math.dist(a, b), 0.1)

    def test_schema_and_label(self):
        self.assertEqual(schema.errors(self.doc, schema.load("motion")), [])
        self.assertTrue(self.doc["synthetic"])
        self.assertEqual(self.doc["label"], "Synthetic sample house")

    def test_committed_fixture_matches(self):
        self.assertEqual(support.fixture("motion.json"), self.doc)

    def test_schema_rejects_a_broken_motion_file(self):
        bad = dict(self.doc, samples=[dict(self.samples[0], tilt_deg="17")])
        self.assertTrue(schema.errors(bad, schema.load("motion")))


if __name__ == "__main__":
    unittest.main()
