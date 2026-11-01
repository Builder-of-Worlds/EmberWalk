import copy
import json
import math
import os
import subprocess
import unittest

import support
from ewscene import assets, downspout, house, schema

PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_gutter_models.py")
BLENDER = support.blender_path()
OUTWARD = {"west": (-1, 0), "east": (1, 0), "south": (0, -1), "north": (0, 1)}
BROADLEAF = ("main", "Leaf tan", "Leaf rust", "Leaf grey brown")
HOUSES = ("hero-before", "apartment-before")
SYNTHETIC = os.path.join(support.REPO_DIR, "fixtures", "synthetic")


def pieces(parts, keys):
    return [c for k in keys for c in parts[k]["components"]]


def thin(c):
    return c["elong"] >= 6.0


def spec_of(name):
    return copy.deepcopy(support.load_json(os.path.join(SYNTHETIC, name, "spec.json")))


def without_downspouts(spec):
    spec["house"]["features"].pop("downspouts", None)
    return spec


def ask(spec, side, along):
    spec["house"]["features"]["downspouts"] = [{"side": side, "along_in": along}]
    return spec


class Downspouts(unittest.TestCase):
    def test_a_spec_without_the_field_has_no_downspouts(self):
        for name in HOUSES:
            self.assertEqual(downspout.plan(without_downspouts(spec_of(name))), [], name)

    def test_each_outlet_the_spec_names_is_planned_on_the_wall_it_names(self):
        for name in HOUSES:
            spec = spec_of(name)
            asked = spec["house"]["features"]["downspouts"]
            self.assertGreaterEqual(len(asked), 1, name)
            planned = downspout.plan(spec)
            self.assertEqual([(p["side"], p["along_in"]) for p in planned], [(a["side"], a["along_in"]) for a in asked], name)

    def test_the_hero_house_has_one_at_the_garage_corner(self):
        asked = spec_of("hero-before")["house"]["features"]["downspouts"]
        self.assertEqual([a["side"] for a in asked], ["garage_side"])

    def test_the_after_house_keeps_the_downspouts(self):
        before = spec_of("hero-before")
        changes = support.load_json(os.path.join(SYNTHETIC, "hero-after", "changes.json"))
        after = house.after_spec(before, changes, assets.load_catalog(), house.load_rules())
        self.assertEqual(after["house"]["features"]["downspouts"], before["house"]["features"]["downspouts"])
        self.assertEqual(len(downspout.plan(after)), 1)

    def test_the_schema_takes_the_field_and_refuses_a_bad_value(self):
        sch = schema.load("house-spec")
        for name in HOUSES:
            self.assertEqual(schema.errors(spec_of(name), sch), [], name)
        for bad in ([{"side": "front"}], [{"along_in": 8}], [{"side": "front", "along_in": -1}], [{"side": "front", "along_in": 2.5}],
                    [{"side": "Front", "along_in": 8}], [{"side": "front", "along_in": 8, "extra": 1}], [], "front"):
            spec = spec_of("hero-before")
            spec["house"]["features"]["downspouts"] = bad
            self.assertNotEqual(schema.errors(spec, sch), [], repr(bad))

    def test_the_pipe_reaches_from_the_gutter_down_to_near_the_ground_hugging_the_wall(self):
        for name in HOUSES:
            for p in downspout.plan(spec_of(name)):
                zs = [z for ring in p["rings"] for _, _, z in ring]
                floor = p["gutter_z_in"] - downspout.GUTTER_TALL_IN
                self.assertGreater(max(zs), floor, "%s: the top is in the gutter floor" % name)
                self.assertLess(max(zs), floor + 3.0, name)
                self.assertGreaterEqual(min(zs), p["ground_in"] + 5.0, name)
                self.assertLessEqual(min(zs), p["ground_in"] + 8.0, name)
                wall = [pt for pt in p["points"] if abs(pt[0] - downspout.WALL_O_IN) < 1e-6]
                self.assertEqual(len(wall), 2, "%s: a straight run on the wall, from the elbow down to the kick" % name)
                self.assertGreater(wall[0][1] - wall[1][1], 60.0, name)
                self.assertGreater(p["points"][-1][0], p["points"][-2][0], "%s: the foot kicks out from the wall" % name)

    def test_the_outlet_is_in_the_flat_floor_of_a_gutter_run(self):
        for name in HOUSES:
            spec = spec_of(name)
            eave = spec["house"]["roof"]["eave_in"]
            for p in downspout.plan(spec):
                top = p["points"][0][0]
                self.assertGreater(top - 1.0, eave + 0.6, name)
                self.assertLess(top + 1.0, 2 * eave - 1.7, name)

    def test_a_pipe_that_would_cross_a_roof_is_refused_naming_the_outlet(self):
        spec = spec_of("hero-before")
        low_roof = {"ridge": "east_west", "lo": [340, 270], "hi": [400, 330], "wall_in": 108, "eave_z_in": 60, "ridge_z_in": 90}
        with self.assertRaises(house.HouseError) as caught:
            downspout.plan(spec, house.roof_prisms(spec) + [low_roof])
        message = str(caught.exception)
        self.assertIn("downspouts[0]", message)
        self.assertIn("garage_side", message)
        self.assertIn("roof", message)

    def test_a_roof_that_misses_the_pipe_does_not_stop_it(self):
        spec = spec_of("hero-before")
        far = {"ridge": "east_west", "lo": [500, 500], "hi": [560, 560], "wall_in": 108, "eave_z_in": 60, "ridge_z_in": 90}
        self.assertEqual(len(downspout.plan(spec, house.roof_prisms(spec) + [far])), 1)

    def test_the_real_pipe_never_sits_inside_any_roof(self):
        for name in HOUSES:
            spec = spec_of(name)
            prisms = house.roof_prisms(spec)
            for p in downspout.plan(spec):
                for pt in downspout.samples(p["rings"]):
                    self.assertIsNone(downspout.inside_roof(prisms, pt), "%s: %s" % (name, pt))

    def test_a_window_a_door_the_garage_door_the_chimney_or_a_vent_on_the_wall_stops_the_drop(self):
        features = lambda s: s["house"]["features"]
        cases = (
            ("windows", "garage_side", 8, lambda s: features(s).setdefault("windows", []).append(
                {"side": "garage_side", "along_in": 4, "width_in": 24, "height_in": 40, "sill_in": 48})),
            ("front_door", "front", 340, lambda s: s["front_door"].update({"along_in": 325})),
            ("back_door", "back", 100, lambda s: s["back_door"].update({"along_in": 90})),
            ("garage_door", "garage_side", 8, lambda s: features(s).__setitem__("garage_door", {"side": "garage_side", "along_in": 0, "width_in": 40, "height_in": 84})),
            ("chimney", "garage_side", 8, lambda s: features(s).__setitem__("chimney", {"side": "garage_side", "along_in": 0, "size_in": [20, 12, 190]})),
            ("foundation_vents", "garage_side", 8, lambda s: features(s)["foundation_vents"].append(
                {"side": "garage_side", "along_in": 0, "width_in": 24, "height_in": 8, "elevation_in": 6})),
        )
        for key, side, along, change in cases:
            spec = ask(spec_of("hero-before"), side, along)
            change(spec)
            with self.assertRaises(house.HouseError, msg=key) as caught:
                downspout.plan(spec)
            self.assertIn("downspouts[0]", str(caught.exception), key)
            self.assertIn(key, str(caught.exception), key)

    def test_a_wall_with_no_gutter_above_it_is_refused(self):
        with self.assertRaises(house.HouseError) as caught:
            downspout.plan(ask(spec_of("hero-before"), "left", 500))
        self.assertIn("gutter", str(caught.exception))

    def test_a_pipe_hanging_past_the_end_of_its_gutter_run_is_refused(self):
        for along in (4, 7):
            with self.assertRaises(house.HouseError, msg=along) as caught:
                downspout.plan(ask(spec_of("hero-before"), "garage_side", along))
            self.assertIn("gutter", str(caught.exception))

    def test_a_house_without_gutters_refuses_downspouts(self):
        with self.assertRaises(house.HouseError) as caught:
            downspout.plan(ask(spec_of("mobile-before"), "front", 20))
        self.assertIn("gutters", str(caught.exception))

    def test_the_house_check_refuses_a_bad_outlet_before_anything_is_built(self):
        spec = ask(spec_of("hero-before"), "garage_side", 4)
        with self.assertRaises(house.HouseError):
            house.validate(spec, assets.load_catalog(), house.load_rules())


@unittest.skipUnless(BLENDER, "Blender not found: the gutter model probe did not run, so this is a PARTIAL RUN")
class GutterModels(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE],
                             capture_output=True, text=True, timeout=600)
        cls.err = run.stderr[-600:]
        line = next((l for l in run.stdout.splitlines() if l.startswith("EW_MODELS ")), None)
        cls.models = json.loads(line[10:]) if line else None

    def setUp(self):
        self.assertTrue(self.models, self.err)

    def runs(self):
        for name in HOUSES:
            for k, r in enumerate(self.models["gutters"][name]["runs"], 1):
                yield "%s run %d" % (name, k), r

    def leaf_hazards(self):
        for name in HOUSES:
            for h in self.models["leaves"][name]:
                yield "%s %s" % (name, h["id"]), h

    def test_each_gutter_is_an_open_trough_with_a_back_a_floor_a_front_and_ends(self):
        for label, r in self.runs():
            rays, width = r["rays"], r["width"]
            self.assertIsNotNone(rays["down"], label)
            self.assertLess(rays["down"]["z"], 1.0, "%s: a ray dropped into the gutter must land on its floor" % label)
            self.assertIsNone(rays["up"], "%s: the top is open, nothing is over the middle of the trough" % label)
            self.assertLess(rays["to_back"]["v"], 1.0, "%s: back wall" % label)
            self.assertGreater(rays["to_front"]["v"], width - 1.0, "%s: front wall" % label)
            self.assertGreater(rays["from_outside"]["v"], width - 1.0, "%s: the front face is seen from outside" % label)
            self.assertIsNotNone(rays["end_cap"], "%s: end cap" % label)
            self.assertLess(abs(rays["end_cap"]["u"]), 0.1, "%s: end cap" % label)

    def test_a_gutter_is_a_thin_shell_not_a_solid_box(self):
        for label, r in self.runs():
            box = r["width"] * r["length"] * self.models["lip_in"]
            self.assertLess(r["volume_in3"], 0.3 * box, label)
            self.assertGreater(r["volume_in3"], 0.03 * box, label)

    def test_the_gutter_keeps_the_footprint_and_height_of_the_old_box(self):
        for label, r in self.runs():
            g = r["run"]
            (x0, y0), (x1, y1) = g["start"], g["end"]
            ox, oy = OUTWARD[g["facing"]]
            xs, ys = sorted((x0, x1, x0 + ox * r["width"], x1 + ox * r["width"])), sorted((y0, y1, y0 + oy * r["width"], y1 + oy * r["width"]))
            want = [[xs[0], ys[0], g["z_in"] - self.models["lip_in"]], [xs[-1], ys[-1], g["z_in"]]]
            for got_end, want_end in zip(r["bounds"], want):
                for got, expected in zip(got_end, want_end):
                    self.assertAlmostEqual(got, expected, delta=0.01, msg=label)

    def test_a_downspout_is_built_where_the_spec_asks_and_none_where_it_does_not(self):
        for name in HOUSES:
            built = self.models["downspouts"][name]
            self.assertEqual(len(built["asked"]["pipes"]), len(spec_of(name)["house"]["features"]["downspouts"]), name)
            self.assertEqual(built["none"]["pipes"], [], name)

    def test_a_downspout_is_one_closed_pipe_in_the_gutter_paint(self):
        for name in HOUSES:
            built = self.models["downspouts"][name]["asked"]
            for pipe in built["pipes"]:
                self.assertEqual(pipe["material"], built["gutter_material"], name)
                self.assertGreaterEqual(pipe["faces"], 4 * 4 + 2, name)

    def test_the_built_pipe_runs_from_the_gutter_floor_to_near_the_ground_on_the_wall(self):
        for name in HOUSES:
            spec = spec_of(name)
            for want, pipe in zip(downspout.plan(spec), self.models["downspouts"][name]["asked"]["pipes"]):
                (_, _, z0), (_, _, z1) = pipe["bounds"]
                self.assertAlmostEqual(z1, want["gutter_z_in"] - downspout.GUTTER_TALL_IN + 0.5, delta=0.01, msg=name)
                self.assertGreaterEqual(z0, want["ground_in"] + 5.0, name)
                self.assertLessEqual(z0, want["ground_in"] + 8.0, name)

    def test_no_built_downspout_vertex_is_inside_a_roof(self):
        for name in HOUSES:
            prisms = house.roof_prisms(spec_of(name))
            for pipe in self.models["downspouts"][name]["asked"]["pipes"]:
                for a, b in pipe["edges"]:
                    p, q = pipe["verts"][a], pipe["verts"][b]
                    steps = max(1, int(math.dist(p, q) / 0.25))
                    for s in range(steps + 1):
                        pt = [p[c] + (q[c] - p[c]) * s / steps for c in range(3)]
                        self.assertIsNone(downspout.inside_roof(prisms, pt), "%s: %s at %s" % (name, pipe["name"], pt))

    def test_the_gutter_has_its_own_paint_not_the_trim_paint(self):
        for name in HOUSES:
            g = self.models["gutters"][name]
            for r in g["runs"]:
                mat = r["material"]
                self.assertNotEqual(mat["name"], g["trim"]["name"])
                apart = math.dist(mat["colour"], g["trim"]["colour"])
                self.assertTrue(apart > 0.02 or abs(mat["roughness"] - g["trim"]["roughness"]) > 0.05, name)

    def test_the_leaves_are_many_separate_pieces_of_real_shape(self):
        for label, h in self.leaf_hazards():
            found = pieces(h["parts"], BROADLEAF)
            self.assertGreaterEqual(len(found), 2.5 * h["size_in"][0], label)
            for c in found:
                self.assertGreaterEqual(c["verts"], 6, label)
            for k in BROADLEAF:
                self.assertTrue(all(n >= 6 for n in map(int, h["parts"][k]["face_sizes"])), "%s %s: no card shaped faces" % (label, k))

    def test_the_leaves_are_dry_in_more_than_one_colour(self):
        for label, h in self.leaf_hazards():
            used = [k for k in BROADLEAF if h["parts"][k]["components"]]
            self.assertGreaterEqual(len(used), 3, label)
            colours = [tuple(self.models["accents"][k]) for k in used if k != "main"]
            self.assertEqual(len(set(colours)), len(colours), label)

    def test_the_leaves_stay_in_the_box_at_full_size_and_fill_it(self):
        for label, h in self.leaf_hazards():
            size = h["size_in"]
            found = pieces(h["parts"], BROADLEAF)
            for c in found:
                for i in range(3):
                    self.assertGreaterEqual(c["min"][i], -0.01, label)
                    self.assertLessEqual(c["max"][i], size[i] + 0.01, label)
            for built in h["squash"]:
                self.assertAlmostEqual(built, 1.0, delta=0.03, msg="%s: leaves are built to the box, not squashed into it" % label)
            everything = pieces(h["parts"], h["parts"].keys())
            for i in range(3):
                self.assertAlmostEqual(min(c["min"][i] for c in everything), 0.0, delta=0.05, msg=label)
                self.assertAlmostEqual(max(c["max"][i] for c in everything), size[i], delta=0.05, msg=label)

    def test_a_share_of_the_leaves_heaps_above_the_lip_and_some_hang_over_the_front(self):
        for label, h in self.leaf_hazards():
            front = h["size_in"][1] - self.models["spill_in"]
            found = pieces(h["parts"], BROADLEAF)
            above = [c for c in found if (c["min"][2] + c["max"][2]) / 2.0 > self.models["lip_in"]]
            over = [c for c in found if c["max"][1] > front]
            self.assertGreaterEqual(len(above) / float(len(found)), 0.4, label)
            self.assertGreaterEqual(len(over) / float(len(found)), 0.05, label)

    def test_pine_needles_are_long_and_thin(self):
        for label, h in self.leaf_hazards():
            needles = h["parts"]["Pine needles"]["components"]
            self.assertGreaterEqual(len(needles), h["size_in"][0], label)
            self.assertGreaterEqual(sum(1 for c in needles if thin(c)) / float(len(needles)), 0.9, label)

    def test_branch_leaves_have_six_or_more_vertex_outlines_and_no_flat_cards(self):
        branch = self.models["foliage"]["branch"]
        found = pieces(branch, ("Dry leaves", "Dry leaves tan"))
        self.assertGreaterEqual(len(found), 300)
        for k in ("Dry leaves", "Dry leaves tan"):
            self.assertTrue(all(int(n) >= 6 for n in branch[k]["face_sizes"]), k)
        self.assertTrue(all(c["verts"] >= 6 for c in found))

    def test_oak_leaves_have_six_or_more_vertex_outlines_and_no_flat_cards(self):
        oak = self.models["foliage"]["oak"]["leaves"]
        self.assertNotIn("4", oak["face_sizes"])
        leaf_faces = int(oak["face_sizes"].get("6", 0)) + int(oak["face_sizes"].get("8", 0))
        self.assertGreaterEqual(leaf_faces, 1000)

    def test_drawing_the_leaves_never_moves_the_bark(self):
        moved = [form for form, signs in self.models["bark"].items() if signs["real"] != signs["bare"]]
        self.assertEqual(moved, [], "the bark of these moved with the leaves")

    def test_conifer_foliage_is_needles_long_and_thin(self):
        needles = [c for c in self.models["foliage"]["conifer"]["leaves"]["components"] if c["faces"] == 1]
        self.assertGreaterEqual(len(needles), 5000)
        self.assertGreaterEqual(sum(1 for c in needles if thin(c)) / float(len(needles)), 0.9)


if __name__ == "__main__":
    unittest.main()
