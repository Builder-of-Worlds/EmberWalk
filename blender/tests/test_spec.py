import unittest

import support
from ewscene import assets, spec


def check(doc):
    return spec.validate(doc, assets.load_catalog())


class NormalSpec(unittest.TestCase):
    def test_sample_spec_passes(self):
        doc = check(support.sample_spec())
        self.assertEqual(doc["id"], "test-yard")
        self.assertEqual(len(doc["hazards"]), 3)

    def test_hazard_at_exactly_100_feet_passes(self):
        doc = support.sample_spec()
        h = doc["hazards"][1]
        h["distance_in"] = 1200
        h["size_in"][1] = 24
        check(doc)

    def test_load_reads_file(self):
        import os
        doc = spec.load(os.path.join(support.FIXTURE_DIR, "spec.json"), assets.load_catalog())
        self.assertEqual(doc["walk"]["fps"], 30)


class InvalidSpec(unittest.TestCase):
    def assertInvalid(self, doc, where):
        with self.assertRaises(spec.SpecError) as ctx:
            check(doc)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn(where, str(ctx.exception))

    def test_not_an_object(self):
        self.assertInvalid([], "$")

    def test_missing_hazards(self):
        doc = support.sample_spec()
        del doc["hazards"]
        self.assertInvalid(doc, "hazards")

    def test_unknown_key(self):
        doc = support.sample_spec()
        doc["hazards"][0]["colour"] = "red"
        self.assertInvalid(doc, "colour")

    def test_distance_not_whole_inches(self):
        doc = support.sample_spec()
        doc["hazards"][0]["distance_in"] = 2.5
        self.assertInvalid(doc, "hazards[0].distance_in")

    def test_fps_as_a_float_is_invalid(self):
        doc = support.sample_spec()
        doc["walk"]["fps"] = 30.0
        self.assertInvalid(doc, "walk.fps")

    def test_nan_tilt_is_invalid(self):
        doc = support.sample_spec()
        doc["walk"]["tilt_deg"] = float("nan")
        self.assertInvalid(doc, "walk.tilt_deg: not finite")

    def test_id_with_a_final_newline_is_invalid(self):
        doc = support.sample_spec()
        doc["id"] = "test-yard\n"
        self.assertInvalid(doc, "$.id: does not match")

    def test_boolean_is_not_a_number(self):
        doc = support.sample_spec()
        doc["hazards"][0]["distance_in"] = True
        self.assertInvalid(doc, "hazards[0].distance_in")

    def test_wrong_label(self):
        doc = support.sample_spec()
        doc["label"] = "Sample house"
        self.assertInvalid(doc, "label")

    def test_unknown_concept(self):
        doc = support.sample_spec()
        doc["hazards"][0]["concept"] = "garden gnome"
        self.assertInvalid(doc, "concept")

    def test_house_wall_is_not_a_hazard(self):
        doc = support.sample_spec()
        doc["hazards"][0]["concept"] = "house wall"
        self.assertInvalid(doc, "concept")

    def test_duplicate_ids(self):
        doc = support.sample_spec()
        doc["hazards"][1]["id"] = doc["hazards"][0]["id"]
        self.assertInvalid(doc, "hazards[1].id")

    def test_hazard_past_wall_end(self):
        doc = support.sample_spec()
        doc["hazards"][2]["along_in"] = 526
        self.assertInvalid(doc, "hazards[2].along_in")

    def test_hazard_past_ground_edge(self):
        doc = support.sample_spec()
        doc["ground"]["depth_in"] = 280
        self.assertInvalid(doc, "hazards[2]")

    def test_overlapping_hazards(self):
        doc = support.sample_spec()
        doc["hazards"][1]["along_in"] = 100
        doc["hazards"][1]["distance_in"] = 10
        self.assertInvalid(doc, "overlaps")

    def test_touching_hazards_are_not_overlapping(self):
        doc = support.sample_spec()
        doc["hazards"][1]["along_in"] = 168
        doc["hazards"][1]["distance_in"] = 0
        doc["hazards"][1]["label"] = "required_now"
        check(doc)

    def test_walk_end_before_start(self):
        doc = support.sample_spec()
        doc["walk"]["end_along_in"] = 10
        self.assertInvalid(doc, "walk.end_along_in")

    def test_walk_inside_a_hazard(self):
        doc = support.sample_spec()
        doc["walk"]["standoff_in"] = 80
        self.assertInvalid(doc, "walk")

    def test_zero_size(self):
        doc = support.sample_spec()
        doc["hazards"][0]["size_in"] = [72, 0, 48]
        self.assertInvalid(doc, "hazards[0].size_in")


class RefusedSpec(unittest.TestCase):
    def assertRefused(self, doc, words):
        with self.assertRaises(spec.SpecError) as ctx:
            check(doc)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn(words, str(ctx.exception))

    def test_hazard_past_100_feet(self):
        doc = support.sample_spec()
        doc["hazards"][1]["distance_in"] = 1201
        doc["hazards"][1]["size_in"][1] = 12
        self.assertRefused(doc, "past 100 feet")

    def test_negative_distance(self):
        doc = support.sample_spec()
        doc["hazards"][0]["distance_in"] = -1
        self.assertRefused(doc, "negative distance")

    def test_unknown_asset(self):
        doc = support.sample_spec()
        doc["hazards"][0]["asset"] = "polyhaven:not_a_cleared_asset"
        self.assertRefused(doc, "unknown asset")

    def test_unknown_material(self):
        doc = support.sample_spec()
        doc["wall"]["material"] = "sketchfab:siding"
        self.assertRefused(doc, "unknown asset")

    def test_asset_for_another_concept(self):
        doc = support.sample_spec()
        doc["hazards"][0]["asset"] = "scripted:wood_fence"
        self.assertRefused(doc, "is not a")

    def test_material_used_as_hazard(self):
        doc = support.sample_spec()
        doc["hazards"][0]["asset"] = "polyhaven:weathered_plank_siding"
        self.assertRefused(doc, "is not a")

    def test_texture_used_as_light(self):
        doc = support.sample_spec()
        doc["light"]["hdri"] = "polyhaven:withered_grass"
        self.assertRefused(doc, "is not a")


if __name__ == "__main__":
    unittest.main()
