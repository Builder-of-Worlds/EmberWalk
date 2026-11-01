import json
import os
import subprocess
import unittest

import support

PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_photoscans.py")
BLENDER = support.blender_path()
SLACK_IN = 1.0


class PhotoscanScene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE],
                             capture_output=True, text=True, timeout=900)
        cls.err = run.stderr[-800:] + run.stdout[-400:]
        line = next((l for l in run.stdout.splitlines() if l.startswith("EW_PHOTO ")), None)
        cls.scene = json.loads(line[9:]) if line else None

    def setUp(self):
        self.assertTrue(self.scene, self.err)

    def test_every_lot_tree_is_a_photoscan_model_not_scripted_geometry(self):
        self.assertGreaterEqual(len(self.scene["trees"]), 10)
        for tree_id, parts in self.scene["trees"].items():
            self.assertTrue(all(p["photo"] for p in parts), tree_id)
            self.assertGreater(sum(p["polys"] for p in parts), 50000, tree_id)

    def test_each_hazard_with_a_photoscan_is_a_model_inside_its_spec_box(self):
        self.assertTrue(self.scene["photo_hazards"])
        for hazard_id in self.scene["photo_hazards"]:
            got, box = self.scene["hazards"][hazard_id], self.scene["boxes"][hazard_id]
            self.assertTrue(got["photo"], hazard_id)
            self.assertGreaterEqual(got["lo"][0], box[0] - SLACK_IN, hazard_id)
            self.assertGreaterEqual(got["lo"][1], box[1] - SLACK_IN, hazard_id)
            self.assertLessEqual(got["hi"][0], box[2] + SLACK_IN, hazard_id)
            self.assertLessEqual(got["hi"][1], box[3] + SLACK_IN, hazard_id)
            self.assertGreaterEqual(got["lo"][2], box[4] - SLACK_IN, hazard_id)
            self.assertLessEqual(got["hi"][2], box[5] + SLACK_IN, hazard_id)

    def test_the_lot_carries_scattered_grass_blades(self):
        self.assertGreater(self.scene["meadow"], 1000000)

    def test_garage_door_wears_the_same_siding_as_the_house_wall(self):
        siding = self.scene["siding"]
        self.assertTrue(siding["wall"])
        self.assertEqual(siding["door"], siding["wall"])
        self.assertEqual(siding["panels"], siding["wall"])

    def test_the_garage_door_is_a_plain_raised_panel_door_not_a_grid_of_windows(self):
        g = self.scene["garage"]
        self.assertEqual((g["cols"], g["rows"]), (4, 4))
        self.assertLessEqual(g["relief_in"], 1.2)
        self.assertGreaterEqual(g["span_in"] / g["cols"], 40.0)

    def test_a_shadowless_fill_lights_every_wall_direction_so_no_side_goes_dark(self):
        for normal in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            self.assertTrue(any(f[0] * normal[0] + f[1] * normal[1] < -0.2 for f in self.scene["fills"]), (normal, self.scene["fills"]))

    def test_a_woodland_ring_stands_around_the_lot(self):
        self.assertGreaterEqual(self.scene["ring_trees"], 200)

    def test_the_before_front_yard_has_a_mulch_bed_with_shrubs_and_a_walk(self):
        yard = self.scene["yard"]
        self.assertTrue([n for n in yard["bed"] if "wood_chips" in n], yard["bed"])
        self.assertGreaterEqual(len(yard["shrubs"]), 2)
        self.assertTrue(yard["walk"])

    def test_the_haze_is_a_compositor_pass_not_a_world_volume(self):
        self.assertTrue(self.scene["haze"])

    def test_the_hero_walls_carry_lap_boards_that_stand_proud_of_the_wall_and_are_not_hazards(self):
        laps = self.scene["laps"]
        self.assertTrue(laps)
        self.assertFalse(laps["tagged"])
        self.assertGreater(laps["faces"], 2000)
        for axis in (0, 1):
            self.assertLessEqual(laps["wall_lo"][axis] - laps["lo"][axis], 1.0)
            self.assertGreaterEqual(laps["wall_lo"][axis] - laps["lo"][axis], 0.3)
            self.assertLessEqual(laps["hi"][axis] - laps["wall_hi"][axis], 1.0)
            self.assertGreaterEqual(laps["hi"][axis] - laps["wall_hi"][axis], 0.3)
        self.assertGreaterEqual(laps["lo"][2], -0.01)
        self.assertLessEqual(laps["hi"][2], laps["wall_hi"][2] + 0.01)

    def test_lap_boards_are_set_a_board_apart_from_the_ground_to_the_eave(self):
        laps = self.scene["laps"]
        pitch = laps["wall_in"] / round(laps["wall_in"] / 6.5)
        for k in range(round(laps["wall_in"] / pitch) + 1):
            self.assertTrue(any(abs(z - k * pitch) < 0.02 for z in laps["levels"]), k)

    def test_the_hero_roof_is_dark_rough_asphalt_with_shingle_courses_you_can_see(self):
        self.assertTrue(self.scene["roofs"])
        for roof in self.scene["roofs"]:
            self.assertLessEqual(roof["albedo"], 0.026)
            self.assertGreaterEqual(roof["rough_floor"], 0.85)
            self.assertLessEqual(roof["specular"], 0.2)
            self.assertGreaterEqual(roof["normal"], 1.2)
            self.assertGreaterEqual(roof["tile_m"], 2.4)
            self.assertLessEqual(roof["tile_m"], 5.0)

    def test_no_wall_is_tagged_as_a_hazard(self):
        self.assertTrue(self.scene["walls"])
        self.assertFalse([w for w in self.scene["walls"] if w["tagged"]])


if __name__ == "__main__":
    unittest.main()
