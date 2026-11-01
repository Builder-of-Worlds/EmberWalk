import copy
import os
import unittest

import support
from ewscene import assets, house, meadow, photoscan, route, truth

SYNTHETIC = os.path.join(support.REPO_DIR, "fixtures", "synthetic")
HOUSES = ("hero-before", "mobile-before", "apartment-before")
REPLACED = {
    "scripted:lot_tree": ("oak", "conifer"),
    "scripted:dead_shrub": ("default",),
    "scripted:propane_tank": ("default",),
    "scripted:trash_cans": ("default",),
    "scripted:patio_set": ("default",),
}


def spec_of(name):
    return copy.deepcopy(support.load_json(os.path.join(SYNTHETIC, name, "spec.json")))


def read(name, file):
    with open(os.path.join(SYNTHETIC, name, file), encoding="utf-8") as f:
        return f.read()


class Catalog(unittest.TestCase):
    def test_every_stand_in_with_a_photoscan_names_a_cleared_model(self):
        catalog = assets.load_catalog()
        for asset_id, forms in REPLACED.items():
            for form in forms:
                variants = photoscan.variants(catalog[asset_id], form)
                self.assertTrue(variants, "%s %s" % (asset_id, form))
                for v in variants:
                    entry = catalog[v["id"]]
                    self.assertEqual(entry["kind"], "model", v["id"])
                    self.assertEqual(entry["license"], "CC0-1.0", v["id"])
                    self.assertTrue(v["pick"], v["id"])

    def test_a_scripted_asset_with_no_photoscan_has_no_variants(self):
        catalog = assets.load_catalog()
        self.assertEqual(photoscan.variants(catalog["scripted:storage_shed"], "default"), [])

    def test_the_hero_house_fetches_every_photoscan_it_places(self):
        catalog = assets.load_catalog()
        spec = spec_of("hero-before")
        ids = [u["id"] for u in house.used_assets(spec, catalog)]
        for form in ("oak", "conifer"):
            for v in photoscan.variants(catalog["scripted:lot_tree"], form):
                self.assertIn(v["id"], ids)
        for h in spec["hazards"]:
            for v in photoscan.variants(catalog[h["asset"]], "default"):
                self.assertIn(v["id"], ids)

    def test_the_hero_look_is_the_photo_look(self):
        look = spec_of("hero-before")["look"]
        self.assertEqual(look["siding"]["material"], "polyhaven:exterior_wall_cladding_03")
        self.assertEqual(look["light"]["hdri"], "polyhaven:belfast_farmhouse")
        self.assertEqual(look["ground"]["material"], "polyhaven:withered_grass")

    def test_every_fetched_asset_is_poly_haven_and_has_a_cleared_source(self):
        for asset_id, entry in assets.load_catalog().items():
            if entry["kind"] != "scripted":
                self.assertEqual(entry["source"], "https://polyhaven.com/a/" + asset_id.split(":", 1)[1])


class Answer(unittest.TestCase):
    def test_motion_and_parts_stay_byte_identical_for_every_house(self):
        catalog, rules = assets.load_catalog(), house.load_rules()
        for name in HOUSES:
            doc = spec_of(name)
            house.validate(doc, catalog, rules)
            house.roof_prisms(doc)
            motion_doc, parts_doc = route.build(doc)
            self.assertEqual(truth.dumps(motion_doc), read(name, "motion.json"), name)
            self.assertEqual(truth.dumps(parts_doc), read(name, "parts.json"), name)


class Meadow(unittest.TestCase):
    def setUp(self):
        self.spec = spec_of("hero-before")
        self.tufts = meadow.tufts(self.spec)

    def test_the_lot_is_covered_with_dense_grass(self):
        self.assertGreater(len(self.tufts), 60000)

    def test_grass_is_the_same_every_build(self):
        self.assertEqual(self.tufts[:50], meadow.tufts(copy.deepcopy(self.spec))[:50])

    def test_no_grass_grows_through_the_house_a_structure_or_a_hazard(self):
        eds = house.edges(self.spec)
        rects = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in self.spec["structures"]]
        rects += [(b[0], b[1], b[3], b[4]) for b in route.hazard_boxes(self.spec).values()]
        for t in self.tufts:
            x, y = t["at_in"]
            self.assertFalse(house.overlaps_house((x, y, x, y), eds), t)
            for r in rects:
                self.assertFalse(r[0] <= x <= r[2] and r[1] <= y <= r[3], (t, r))

    def test_grass_stays_in_the_lot_and_below_eye_height(self):
        lot = self.spec["lot"]
        for t in self.tufts:
            self.assertTrue(lot["min_in"][0] <= t["at_in"][0] <= lot["max_in"][0])
            self.assertTrue(lot["min_in"][1] <= t["at_in"][1] <= lot["max_in"][1])
            self.assertLess(t["tall_in"], self.spec["route"]["height_in"] * 0.6)

    def test_the_walk_lane_carries_only_short_stubble(self):
        lanes = meadow.walk_lanes(self.spec)
        inside = [t for t in self.tufts if any(r[0] <= t["at_in"][0] <= r[2] and r[1] <= t["at_in"][1] <= r[3] for r in lanes)]
        self.assertGreater(len(inside), 500)
        self.assertLessEqual(max(t["tall_in"] for t in inside), 5.0)


if __name__ == "__main__":
    unittest.main()
