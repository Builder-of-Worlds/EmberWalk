import copy
import math
import os
import unittest

import support
from ewscene import assets, house, laps, meadow, photoscan, route, woods

SYNTHETIC = os.path.join(support.REPO_DIR, "fixtures", "synthetic")
OTHERS = ("mobile", "apartment")
CATALOG = assets.load_catalog()
RULES = house.load_rules()


def spec_of(name):
    return copy.deepcopy(support.load_json(os.path.join(SYNTHETIC, name + "-before", "spec.json")))


class PhotoLook(unittest.TestCase):
    """The mobile home and the apartment wear the hero's Poly Haven photoscan look."""

    def test_both_houses_switch_the_photoscan_look_on(self):
        for name in OTHERS:
            self.assertIs(spec_of(name)["look"]["photoscans"], True, name)

    def test_both_houses_stand_under_the_hero_sky_haze_and_warm_light(self):
        hero = spec_of("hero")["look"]["light"]
        for name in OTHERS:
            light = spec_of(name)["look"]["light"]
            self.assertEqual(light["hdri"], "polyhaven:belfast_farmhouse", name)
            for key in ("warm", "fill", "haze", "sky"):
                self.assertEqual(light[key], hero[key], (name, key))

    def test_both_houses_stand_on_the_hero_ground_mix_and_in_a_woodland(self):
        hero = spec_of("hero")["look"]["ground"]
        for name in OTHERS:
            look = spec_of(name)["look"]
            self.assertEqual(look["ground"], hero, name)
            self.assertIn("woods", look, name)

    def test_the_roofs_are_dark_rough_asphalt_like_the_hero_and_not_pale_grey(self):
        for name in OTHERS:
            colour = spec_of(name)["look"]["roof"]["colour"].lstrip("#")
            grey = sum(int(colour[i:i + 2], 16) for i in (0, 2, 4)) / 3.0
            self.assertLessEqual(grey, 90, name)

    def test_the_mobile_home_wears_the_hero_lap_siding_texture(self):
        self.assertEqual(spec_of("mobile")["look"]["siding"]["material"], "polyhaven:exterior_wall_cladding_03")

    def test_every_photoscan_the_house_places_is_fetched(self):
        for name in OTHERS:
            spec = spec_of(name)
            ids = [u["id"] for u in house.used_assets(spec, CATALOG)]
            for form in ("oak", "conifer"):
                for v in photoscan.variants(CATALOG["scripted:lot_tree"], form):
                    self.assertIn(v["id"], ids, (name, form))
            for h in spec["hazards"]:
                for v in photoscan.variants(CATALOG[h["asset"]], "default"):
                    self.assertIn(v["id"], ids, (name, h["id"]))

    def test_both_specs_still_pass_the_house_check(self):
        for name in OTHERS:
            house.validate(spec_of(name), CATALOG, RULES)


class Laps(unittest.TestCase):
    def test_lap_boards_go_on_a_lap_sided_house_and_not_on_stucco(self):
        self.assertTrue(laps.wanted(spec_of("hero")))
        self.assertTrue(laps.wanted(spec_of("mobile")))
        self.assertFalse(laps.wanted(spec_of("apartment")))

    def test_no_lap_boards_without_the_photo_look(self):
        spec = spec_of("mobile")
        spec["look"]["photoscans"] = False
        self.assertFalse(laps.wanted(spec))


class Woodland(unittest.TestCase):
    def setUp(self):
        self.specs = {name: spec_of(name) for name in OTHERS}
        self.rings = {name: woods.ring(spec) for name, spec in self.specs.items()}

    def test_each_lot_sits_in_a_woodland_of_pines_and_oaks(self):
        for name, trees in self.rings.items():
            self.assertGreaterEqual(len(trees), 120, name)
            self.assertEqual({t["form"] for t in trees}, {"oak", "conifer"}, name)

    def test_no_tree_stands_on_a_structure_a_walk_lane_or_inside_the_lot_trees(self):
        for name, trees in self.rings.items():
            spec = self.specs[name]
            rects = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in spec["structures"]] + meadow.walk_lanes(spec)
            for t in trees:
                x, y = t["at_in"]
                for r in rects:
                    self.assertFalse(r[0] <= x <= r[2] and r[1] <= y <= r[3], (name, t["id"], r))
            own = [t["at_in"] for t in trees] + [t["at_in"] for t in spec.get("trees") or []]
            for i, a in enumerate(own):
                for b in own[i + 1:]:
                    self.assertGreater(math.hypot(a[0] - b[0], a[1] - b[1]), 90.0, name)

    def test_close_trees_keep_their_crowns_clear_of_every_hazard_box(self):
        for name, trees in self.rings.items():
            for t in [t for t in trees if t["band"] == "close"]:
                x, y = t["at_in"]
                for key, b in route.hazard_boxes(self.specs[name]).items():
                    gap = math.hypot(max(b[0] - x, 0.0, x - b[3]), max(b[1] - y, 0.0, y - b[4]))
                    self.assertGreater(gap, 0.35 * t["canopy_in"] + woods.HAZARD_CLEAR_IN - 1, (name, t["id"], key))

    def test_distant_trees_stay_under_the_sky_angle(self):
        for name, trees in self.rings.items():
            box = woods._house_box(self.specs[name])
            for t in [t for t in trees if t["band"] in ("far", "treeline")]:
                limit = next(b["sky_deg"] for b in woods.BANDS if b["name"] == t["band"])
                reach = woods._reach(box, *t["at_in"])
                self.assertLessEqual(math.degrees(math.atan(t["height_in"] / reach)), limit + 0.2, (name, t))


if __name__ == "__main__":
    unittest.main()
