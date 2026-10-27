import unittest

import support
from ewscene import placement, units


class Bands(unittest.TestCase):
    def test_band_edges_go_to_the_closer_band(self):
        self.assertEqual(placement.band(0), "0_5")
        self.assertEqual(placement.band(60), "0_5")
        self.assertEqual(placement.band(61), "5_30")
        self.assertEqual(placement.band(360), "5_30")
        self.assertEqual(placement.band(361), "30_100")
        self.assertEqual(placement.band(1200), "30_100")

    def test_band_refuses_past_100_feet(self):
        with self.assertRaises(ValueError):
            placement.band(1201)

    def test_band_refuses_negative(self):
        with self.assertRaises(ValueError):
            placement.band(-1)


class Boxes(unittest.TestCase):
    def test_hazard_box_starts_at_its_distance(self):
        h = support.sample_spec()["hazards"][1]
        lo, hi = placement.hazard_box(h)
        self.assertEqual(lo, (252, 62, 0))
        self.assertEqual(hi, (306, 102, 30))

    def test_distance_is_the_near_face(self):
        h = support.sample_spec()["hazards"][1]
        self.assertEqual(placement.distance_from_wall(placement.hazard_box(h)), 62)

    def test_overlap_is_strict(self):
        a = ((0, 0, 0), (10, 10, 10))
        self.assertTrue(placement.overlaps(a, ((5, 5, 0), (15, 15, 10))))
        self.assertFalse(placement.overlaps(a, ((10, 0, 0), (20, 10, 10))))
        self.assertFalse(placement.overlaps(a, ((0, 11, 0), (10, 20, 10))))

    def test_walk_line_crossing(self):
        box = ((100, 50, 0), (150, 120, 30))
        self.assertTrue(placement.crosses_walk(box, 80, 0, 400))
        self.assertFalse(placement.crosses_walk(box, 144, 0, 400))
        self.assertFalse(placement.crosses_walk(box, 80, 160, 400))


class Units(unittest.TestCase):
    def test_inch_round_trip(self):
        self.assertAlmostEqual(units.in_to_m(12), 0.3048)
        self.assertAlmostEqual(units.m_to_in(units.in_to_m(77)), 77)

    def test_feet_text(self):
        self.assertEqual(units.feet_inches(0), "0 ft 0 in")
        self.assertEqual(units.feet_inches(62), "5 ft 2 in")
        self.assertEqual(units.feet_inches(1200), "100 ft 0 in")


if __name__ == "__main__":
    unittest.main()
