import copy
import math
import os
import statistics
import unittest

import support
from ewscene import house, meadow, route, woods, yard

SYNTHETIC = os.path.join(support.REPO_DIR, "fixtures", "synthetic")
HERO = "hero-before"
LOT_TREES_MIN = 120
M_TO_IN = 39.37


def spec_of(name=HERO):
    return copy.deepcopy(support.load_json(os.path.join(SYNTHETIC, name, "spec.json")))


def house_box(spec):
    eds = house.edges(spec)
    xs, ys = [e["start"][0] for e in eds], [e["start"][1] for e in eds]
    return min(xs), min(ys), max(xs), max(ys)


def reach(spec, at):
    x0, y0, x1, y1 = house_box(spec)
    return math.hypot(max(x0 - at[0], 0, at[0] - x1), max(y0 - at[1], 0, at[1] - y1))


class Woods(unittest.TestCase):
    def setUp(self):
        self.spec = spec_of()
        self.trees = woods.ring(self.spec)

    def test_the_lot_sits_in_a_woodland_with_both_pines_and_oaks(self):
        self.assertGreaterEqual(len(self.trees), LOT_TREES_MIN)
        forms = {t["form"] for t in self.trees}
        self.assertEqual(forms, {"oak", "conifer"})
        for form in forms:
            self.assertGreater(sum(1 for t in self.trees if t["form"] == form), 30, form)

    def test_trees_stand_beyond_the_lot_edge_in_every_direction(self):
        lot = self.spec["lot"]
        (x0, y0), (x1, y1) = lot["min_in"], lot["max_in"]
        beyond = {"west": lambda p: p[0] < x0, "east": lambda p: p[0] > x1, "south": lambda p: p[1] < y0, "north": lambda p: p[1] > y1}
        for name, test in beyond.items():
            self.assertGreaterEqual(sum(1 for t in self.trees if test(t["at_in"])), 10, name)

    def test_trees_stand_at_several_distances_close_ones_from_eight_metres_the_rest_from_fifteen(self):
        self.assertGreaterEqual(min(reach(self.spec, t["at_in"]) for t in self.trees if t["band"] == "close") / M_TO_IN, 8.0)
        reaches = [reach(self.spec, t["at_in"]) / M_TO_IN for t in self.trees if t["band"] != "close"]
        self.assertGreaterEqual(min(reaches), 15.0)
        for lo, hi in ((15, 25), (25, 40), (40, 60), (60, 110)):
            self.assertGreaterEqual(sum(1 for r in reaches if lo <= r < hi), 8, (lo, hi))

    def test_the_hero_ring_leaves_no_bare_bearing_around_the_house(self):
        box = woods._house_box(self.spec)
        centre = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)
        self.assertFalse(self.spec["look"]["woods"].get("open"))
        for start in range(0, 360, 20):
            inside = [t for t in self.trees if t["band"] != "close" and start <= math.degrees(math.atan2(t["at_in"][1] - centre[1], t["at_in"][0] - centre[0])) % 360.0 < start + 20]
            self.assertGreaterEqual(len(inside), 4, start)

    def test_large_close_trees_stand_behind_and_beside_the_house_and_never_in_front(self):
        box = woods._house_box(self.spec)
        centre = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)
        close = [t for t in self.trees if t["band"] == "close"]
        self.assertGreaterEqual(len(close), 10)
        for t in close:
            bearing = math.degrees(math.atan2(t["at_in"][1] - centre[1], t["at_in"][0] - centre[0]))
            self.assertGreater(abs((bearing + 90.0 + 180.0) % 360.0 - 180.0), woods.FRONT_ARC_DEG, t)
            big = t["height_in"] >= 520 and t["canopy_in"] >= 260 if t["form"] == "conifer" else t["height_in"] >= 480 and t["canopy_in"] >= 480
            self.assertTrue(big, t)
        self.assertGreaterEqual(sum(1 for t in close if t["at_in"][1] > box[3]), 3, "behind")
        self.assertGreaterEqual(sum(1 for t in close if t["at_in"][0] < box[0]), 2, "west")
        self.assertGreaterEqual(sum(1 for t in close if t["at_in"][0] > box[2]), 2, "east")

    def test_close_trees_keep_their_crowns_clear_of_every_hazard_box(self):
        for t in [t for t in self.trees if t["band"] == "close"]:
            x, y = t["at_in"]
            for key, b in route.hazard_boxes(self.spec).items():
                gap = math.hypot(max(b[0] - x, 0.0, x - b[3]), max(b[1] - y, 0.0, y - b[4]))
                self.assertGreater(gap, 0.35 * t["canopy_in"] + woods.HAZARD_CLEAR_IN - 1, (t["id"], key))

    def test_a_window_in_the_look_keeps_trees_out_of_that_bearing_when_asked(self):
        spec = spec_of()
        spec["look"]["woods"]["open"] = [[100, 40]]
        box = woods._house_box(spec)
        centre = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)
        for t in woods.ring(spec):
            bearing = math.degrees(math.atan2(t["at_in"][1] - centre[1], t["at_in"][0] - centre[0]))
            self.assertGreater(abs((bearing - 100 + 180.0) % 360.0 - 180.0), 40, t)

    def test_the_ring_is_the_same_every_build_and_ids_are_unique(self):
        again = woods.ring(copy.deepcopy(self.spec))
        self.assertEqual(self.trees, again)
        self.assertEqual(len({t["id"] for t in self.trees}), len(self.trees))

    def test_no_tree_stands_on_the_road_the_driveway_the_walk_loop_or_another_trunk(self):
        rects = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in self.spec["structures"]]
        lanes = meadow.walk_lanes(self.spec)
        for t in self.trees:
            x, y = t["at_in"]
            for r in rects + lanes:
                self.assertFalse(r[0] <= x <= r[2] and r[1] <= y <= r[3], (t["id"], r))
        own = [t["at_in"] for t in self.trees] + [t["at_in"] for t in self.spec["trees"]]
        for i, a in enumerate(own):
            for b in own[i + 1:]:
                self.assertGreater(math.hypot(a[0] - b[0], a[1] - b[1]), 90.0)

    def test_distant_trees_stay_under_the_sky_angle_so_the_walk_camera_sees_sky(self):
        box = woods._house_box(self.spec)
        far = [t for t in self.trees if t["band"] in ("far", "treeline")]
        self.assertGreater(len(far), 100)
        for t in far:
            limit = next(b["sky_deg"] for b in woods.BANDS if b["name"] == t["band"])
            reach = woods._reach(box, *t["at_in"])
            self.assertLessEqual(math.degrees(math.atan(t["height_in"] / reach)), limit + 0.2, t)

    def test_trees_are_sized_like_pines_and_oaks(self):
        for t in [t for t in self.trees if t["band"] in ("close", "near", "mid")]:
            if t["form"] == "conifer":
                self.assertTrue(500 <= t["height_in"] <= 900 and 200 <= t["canopy_in"] <= 340, t)
            else:
                self.assertTrue(480 <= t["height_in"] <= 760 and 420 <= t["canopy_in"] <= 760, t)

    def test_oaks_are_tall_and_full_not_squat(self):
        oaks = [t for t in self.trees if t["form"] == "oak" and t["band"] in ("close", "near", "mid")]
        self.assertGreater(len(oaks), 20)
        self.assertGreaterEqual(statistics.median(t["height_in"] for t in oaks), 540)
        self.assertGreaterEqual(statistics.median(t["height_in"] / float(t["canopy_in"]) for t in oaks), 0.95)


class Grass(unittest.TestCase):
    def setUp(self):
        self.spec = spec_of()
        self.tufts = meadow.tufts(self.spec)

    def test_grass_near_the_house_is_short_thatch_with_taller_tufts_further_out(self):
        near = [t["tall_in"] for t in self.tufts if reach(self.spec, t["at_in"]) < 300]
        far = [t["tall_in"] for t in self.tufts if reach(self.spec, t["at_in"]) > 1200]
        self.assertGreater(len(near), 3000)
        self.assertLessEqual(statistics.median(near), 6.0)
        self.assertGreater(statistics.median(far), statistics.median(near) * 2.0)
        self.assertLessEqual(max(t["tall_in"] for t in self.tufts), 26.0)

    def test_the_grass_by_the_house_lies_flat_like_thatch_and_stands_up_only_far_out(self):
        def slant(t):
            return math.hypot(*t["lean"]) / t["tall_in"]
        near = [t for t in self.tufts if reach(self.spec, t["at_in"]) < 500]
        far = [t for t in self.tufts if reach(self.spec, t["at_in"]) > 1500]
        self.assertGreater(len(near), 1500)
        self.assertGreater(len(far), 1500)
        self.assertGreaterEqual(statistics.median(slant(t) for t in near), 0.8)
        self.assertLessEqual(statistics.median(slant(t) for t in far), 0.45)
        self.assertLessEqual(statistics.median(t["tall_in"] for t in near), 3.5)
        self.assertLessEqual(max(t["tall_in"] for t in near), 8.0)

    def test_the_height_varies_from_tuft_to_tuft(self):
        near = [t["tall_in"] for t in self.tufts if reach(self.spec, t["at_in"]) < 600]
        self.assertGreater(statistics.pstdev(near), 1.0)

    def test_bare_ground_shows_through_and_green_is_small_and_sparse(self):
        cell = 60
        counts = {}
        for t in self.tufts:
            if reach(self.spec, t["at_in"]) < 900:
                counts[(int(t["at_in"][0] // cell), int(t["at_in"][1] // cell))] = counts.get((int(t["at_in"][0] // cell), int(t["at_in"][1] // cell)), 0) + 1
        dense = statistics.median(counts.values())
        thin = [c for c in counts.values() if c < dense * 0.3]
        self.assertGreater(len(thin) / float(len(counts)), 0.04)
        green = [t for t in self.tufts if t["tone"] == meadow.GREEN]
        share = len(green) / float(len(self.tufts))
        self.assertTrue(0.002 < share < 0.06, share)

    def test_no_grass_grows_on_the_front_bed_or_the_walk(self):
        for t in self.tufts:
            self.assertFalse(yard.contains(self.spec, t["at_in"][0], t["at_in"][1]), t)


class FrontYard(unittest.TestCase):
    def test_the_bed_is_bark_mulch_before_and_gravel_after(self):
        before = spec_of()
        after = copy.deepcopy(before)
        after["state"] = "after"
        self.assertEqual(yard.bed_material(before), "polyhaven:wood_chips")
        self.assertEqual(yard.bed_material(after), "polyhaven:gravel_ground_01")

    def test_dead_shrubs_stand_in_the_bed_before_and_not_after(self):
        before = spec_of()
        after = copy.deepcopy(before)
        after["state"] = "after"
        self.assertGreaterEqual(len(yard.shrubs(before)), 2)
        self.assertEqual(yard.shrubs(after), [])
        for s in yard.shrubs(before):
            self.assertTrue(yard.contains(before, s["at_in"][0], s["at_in"][1]), s)

    def test_no_shrub_stands_in_a_hazard_box_or_the_walk_line_of_sight_to_one(self):
        spec = spec_of()
        for key, b in route.hazard_boxes(spec).items():
            if b[2] > 12:
                continue
            for s in yard.shrubs(spec):
                x, y = s["at_in"]
                r = max(s["size_in"][0], s["size_in"][1]) / 2.0
                self.assertFalse(b[0] - r <= x <= b[3] + r and b[1] - r <= y <= b[4] + r, (key, s))

    def test_the_bed_and_walk_stay_clear_of_every_hazard_box_but_the_ground_under_the_brush(self):
        spec = spec_of()
        for key, b in route.hazard_boxes(spec).items():
            if key == "dry-plants-garage-side" or b[2] > 12:
                continue
            for x in range(int(b[0]), int(b[3]) + 1, 6):
                for y in range(int(b[1]), int(b[4]) + 1, 6):
                    self.assertFalse(yard.contains(spec, x, y), (key, x, y))

    def test_the_walk_joins_the_porch_steps_to_the_driveway(self):
        spec = spec_of()
        quad = yard.walk_polygon(spec)
        self.assertEqual(len(quad), 4)
        steps = next(s for s in spec["structures"] if s["id"] == "front-porch-steps")
        drive = next(s for s in spec["structures"] if s["id"] == "driveway")
        near = lambda p, r: r["min_in"][0] - 30 <= p[0] <= r["max_in"][0] + 30 and r["min_in"][1] - 30 <= p[1] <= r["max_in"][1] + 30
        self.assertTrue(any(near(p, steps) for p in quad))
        self.assertTrue(any(near(p, drive) for p in quad))


class Assets(unittest.TestCase):
    def test_the_yard_names_the_photo_textures_and_shrubs_it_uses_for_each_state(self):
        from ewscene import assets
        catalog = assets.load_catalog()
        before = spec_of()
        after = copy.deepcopy(before)
        after["state"] = "after"
        ids = [u["id"] for u in house.used_assets(before, catalog)]
        for need in ("polyhaven:wood_chips", "polyhaven:park_dirt", "polyhaven:leafy_grass", "polyhaven:searsia_lucida"):
            self.assertIn(need, ids)
        self.assertNotIn("polyhaven:gravel_ground_01", ids)
        ids = [u["id"] for u in house.used_assets(after, catalog)]
        self.assertIn("polyhaven:gravel_ground_01", ids)
        self.assertNotIn("polyhaven:wood_chips", ids)


class Answer(unittest.TestCase):
    def test_the_yard_block_is_optional_and_other_houses_have_none(self):
        for name in ("mobile-before", "apartment-before"):
            spec = spec_of(name)
            self.assertEqual(yard.bed_polygon(spec), [])
            self.assertEqual(yard.shrubs(spec), [])
            self.assertEqual(yard.walk_polygon(spec), [])
            self.assertFalse(yard.contains(spec, 0, 0))


if __name__ == "__main__":
    unittest.main()
