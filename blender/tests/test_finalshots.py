import copy
import math
import os
import unittest

import support
from ewscene import finalshots

GRID = (-12.0, 30.0, -12.0, 34.0)
CAMERA = {"focal_mm": 20, "sensor_width_mm": 36}


def spec():
    return support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json"))


class AerialCentre(unittest.TestCase):
    def test_the_centre_is_the_middle_of_the_footprint_in_metres(self):
        cx, cy = finalshots.aerial_centre(spec(), 40.0, GRID)
        self.assertAlmostEqual(cx, 9.144, places=3)
        self.assertAlmostEqual(cy, 9.906, places=3)

    def test_a_frame_that_leaves_the_scanned_grid_is_refused_naming_the_frame(self):
        with self.assertRaises(ValueError) as e:
            finalshots.aerial_centre(spec(), 100.0, GRID)
        self.assertIn("100 m frame", str(e.exception))

    def test_a_frame_exactly_on_the_grid_edge_is_allowed(self):
        cx, _ = finalshots.aerial_centre(spec(), 2 * (30.0 - 9.144), GRID)
        self.assertAlmostEqual(cx, 9.144, places=3)

    def test_a_house_pushed_east_makes_the_same_frame_leave_the_grid(self):
        moved = copy.deepcopy(spec())
        for side in moved["footprint"]:
            side["start_in"][0] += 200
        with self.assertRaises(ValueError):
            finalshots.aerial_centre(moved, 40.0, GRID)


    def test_each_edge_of_the_grid_refuses_on_its_own(self):
        for axis, delta in ((0, -500), (0, 500), (1, -500), (1, 600)):
            moved = copy.deepcopy(spec())
            for side in moved["footprint"]:
                side["start_in"][axis] += delta
            with self.assertRaises(ValueError, msg="axis %d by %d" % (axis, delta)):
                finalshots.aerial_centre(moved, 40.0, GRID)


class StillPose(unittest.TestCase):
    sample = {"frame": 7, "pos_in": [100.0, 200.0, 54.0], "heading_deg": 90.0, "tilt_deg": 0.0, "roll_deg": 0.0, "shift_y": -0.118087}

    def test_the_camera_stands_where_the_sample_stands_in_metres(self):
        p = finalshots.still_pose(self.sample, CAMERA)
        self.assertEqual([round(v, 4) for v in p["location_m"]], [2.54, 5.08, 1.3716])
        self.assertEqual(p["heading_deg"], 90.0)

    def test_the_lens_shift_is_the_samples_own(self):
        self.assertEqual(finalshots.still_pose(self.sample, CAMERA)["shift_y"], -0.118087)

    def test_a_sample_without_shift_levels_a_tilted_camera_by_its_tilt(self):
        tilted = {k: v for k, v in self.sample.items() if k != "shift_y"}
        tilted["tilt_deg"] = 10.0
        want = -math.tan(math.radians(10.0)) * 20 / 36
        self.assertAlmostEqual(finalshots.still_pose(tilted, CAMERA)["shift_y"], want, places=9)

    def test_the_sample_for_a_frame_is_refused_when_the_list_is_out_of_step(self):
        walk = {"samples": [dict(self.sample, frame=1), dict(self.sample, frame=3)]}
        with self.assertRaises(ValueError) as e:
            finalshots.sample_at(walk, 2)
        self.assertIn("sample 2 is frame 3", str(e.exception))
        self.assertEqual(finalshots.sample_at(walk, 1)["frame"], 1)


DECK = {"min_in": [120, 780, 0], "max_in": [600, 924, 24]}
HALF_FOV_LANDSCAPE = finalshots.HALF_FOV_LANDSCAPE
HALF_FOV_PORTRAIT = finalshots.HALF_FOV_PORTRAIT


def at(x, y, heading, frame=1):
    return {"frame": frame, "pos_in": [x, y, 54.0], "heading_deg": heading, "tilt_deg": 0.0, "roll_deg": 0.0, "shift_y": -0.118}


class DeckInView(unittest.TestCase):
    def test_a_camera_facing_the_deck_from_192_in_sees_it(self):
        self.assertTrue(finalshots.deck_in_view(at(360, 700, 0), DECK, HALF_FOV_LANDSCAPE))

    def test_a_camera_facing_away_does_not(self):
        self.assertFalse(finalshots.deck_in_view(at(360, 700, 180), DECK, HALF_FOV_LANDSCAPE))

    def test_a_camera_far_to_the_side_looking_along_the_wall_does_not(self):
        self.assertFalse(finalshots.deck_in_view(at(-2000, 100, 0), DECK, HALF_FOV_LANDSCAPE))

    def test_a_deck_wider_than_the_view_is_seen_with_every_corner_outside_it(self):
        self.assertTrue(finalshots.deck_in_view(at(360, 800 - 60, 0), DECK, HALF_FOV_LANDSCAPE))

    def test_the_portrait_view_is_narrower_across_than_the_landscape_one(self):
        side = at(-100, 850, 30)
        self.assertTrue(finalshots.deck_in_view(side, DECK, HALF_FOV_LANDSCAPE))
        self.assertFalse(finalshots.deck_in_view(side, DECK, HALF_FOV_PORTRAIT))

    def test_the_candidates_are_the_frames_that_see_it_and_runs_join_neighbours(self):
        walk = {"samples": [at(360, 700, 0, 1), at(360, 700, 0, 2), at(360, 700, 180, 3), at(360, 700, 0, 4)]}
        got = finalshots.deck_candidates(walk, DECK, HALF_FOV_LANDSCAPE)
        self.assertEqual(got, [1, 2, 4])
        self.assertEqual(finalshots.runs(got), [(1, 2), (4, 4)])
        self.assertEqual(finalshots.runs([]), [])


class Facing(unittest.TestCase):
    def test_a_camera_on_the_outward_side_of_a_wall_can_see_the_door(self):
        self.assertTrue(finalshots.faces_camera(at(500, 100, 0), (540, 300), (0, -1)))

    def test_a_camera_behind_the_wall_cannot(self):
        self.assertFalse(finalshots.faces_camera(at(500, 600, 0), (540, 300), (0, -1)))

    def test_the_candidates_keep_only_frames_on_the_outward_side(self):
        walk = {"samples": [at(560, 100, 0, 1), at(560, 600, 180, 2)]}
        box = {"min_in": [540, 296, 12], "max_in": [576, 302, 92]}
        got = finalshots.deck_candidates(walk, box, HALF_FOV_LANDSCAPE, outward=((558, 299), (0, -1)))
        self.assertEqual(got, [1])


class PatchOrder(unittest.TestCase):
    def test_frames_past_the_last_old_one_are_dropped_and_the_public_spans_come_first(self):
        got = finalshots.patch_order([1, 5, 50, 51, 99, 120, 500], 120, ((50, 99),))
        self.assertEqual(got, [50, 51, 99, 1, 5, 120])

    def test_without_priority_spans_it_is_ascending(self):
        self.assertEqual(finalshots.patch_order([9, 3, 5], 9, ()), [3, 5, 9])

    def test_a_slice_of_the_order_is_one_chunk(self):
        order = list(range(1, 11))
        self.assertEqual(finalshots.chunk(order, 0, 4), [1, 2, 3, 4])
        self.assertEqual(finalshots.chunk(order, 8, 4), [9, 10])
        self.assertEqual(finalshots.chunk(order, 12, 4), [])


if __name__ == "__main__":
    unittest.main()
