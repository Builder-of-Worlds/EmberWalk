import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import assets, geom, house, maskbox, route, schema, truth
from test_masks import make_pass

CATALOG = assets.load_catalog()
RULES = house.load_rules()
WRITE = os.path.join(support.BLENDER_DIR, "write_files.py")
CHECK = os.path.join(support.BLENDER_DIR, "check_house.py")
CHANGES = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-after", "changes.json")
BUILD_HOUSE = os.path.join(support.BLENDER_DIR, "build_house.py")
MEASURE = os.path.join(support.BLENDER_DIR, "measure_scene.py")
MASKS = os.path.join(support.BLENDER_DIR, "render_masks.py")
BLENDER = support.blender_path()
STEP = 20
HERO = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json")


def grey_of(linear):
    encoded = linear * 12.92 if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055
    return round(255 * encoded)


def wood_hero(*struct_ids):
    doc = copy.deepcopy(support.load_json(HERO))
    for s in doc["structures"]:
        if s["id"] in struct_ids:
            s["material"] = "wood"
    return doc


class Levels(unittest.TestCase):
    def test_every_level_up_to_the_capacity_is_its_own_grey_and_class(self):
        greys = []
        for index in range(1, maskbox.CAPACITY + 1):
            linear = maskbox.level_to_linear(index)
            grey = grey_of(linear)
            self.assertEqual(maskbox.index_of(grey), index)
            greys.append(grey)
        self.assertEqual(len(set(greys)), maskbox.CAPACITY)
        self.assertLessEqual(max(greys), 255)

    def test_the_capacity_holds_a_hero_house_with_every_wood_finding(self):
        doc = wood_hero("front-porch", "back-deck")
        total = len(doc["hazards"]) + len(doc.get("fixed", [])) + len(house.wood_findings(doc, RULES))
        self.assertGreaterEqual(maskbox.CAPACITY, 2 * total)

    def test_ids_take_levels_in_sorted_order(self):
        self.assertEqual(maskbox.assign(["b", "a", "c"]), {"a": 1, "b": 2, "c": 3})

    def test_more_ids_than_levels_are_refused(self):
        ids = ["h%03d" % n for n in range(maskbox.CAPACITY + 1)]
        self.assertEqual(len(maskbox.assign(ids[:-1])), maskbox.CAPACITY)
        with self.assertRaises(maskbox.MaskError) as caught:
            maskbox.assign(ids)
        self.assertIn("%d hazards" % (maskbox.CAPACITY + 1), str(caught.exception))

    def test_the_same_id_twice_is_refused(self):
        with self.assertRaises(maskbox.MaskError):
            maskbox.assign(["a", "b", "a"])


class HouseBoxes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = wood_hero("front-porch", "back-deck")
        house.validate(cls.spec, CATALOG, RULES)
        house.roof_prisms(cls.spec)
        cls.walk, _ = route.build(cls.spec)
        cls.truth = house.truth_from_spec(cls.spec, RULES)
        cls.hazard_ids = [h["id"] for h in cls.truth["hazards"]]
        cls.wood_ids = [f["id"] for f in cls.truth["structure_hazards"]]

    def attach(self, mask_pass, doc=None):
        return truth.attach_boxes(doc or self.truth, mask_pass, self.walk)

    def test_the_truth_names_both_wood_findings(self):
        self.assertEqual(sorted(self.wood_ids), ["back-deck", "front-porch"])

    def test_a_wood_finding_gets_its_boxes_and_windows_from_the_pass(self):
        frames = {"back-deck": set(range(100, 104)) | {900}, "front-porch": {5}}
        out = self.attach(make_pass(self.walk, self.hazard_ids + self.wood_ids, frames))
        deck = next(f for f in out["structure_hazards"] if f["id"] == "back-deck")
        t = [s["t"] for s in self.walk["samples"]]
        self.assertEqual([b["frame"] for b in deck["frame_boxes"]], [100, 101, 102, 103, 900])
        self.assertEqual(deck["frame_boxes"][0], {"frame": 100, "t": t[99], "box_px": [100, 200, 400, 300], "area_px": 20000})
        self.assertEqual((deck["visible_frames"], deck["visible_s"]), (5, [[t[99], t[102]], [t[899], t[899]]]))
        porch = next(f for f in out["structure_hazards"] if f["id"] == "front-porch")
        self.assertEqual(porch["visible_frames"], 1)

    def test_an_ordinary_hazard_still_gets_its_boxes_beside_them(self):
        out = self.attach(make_pass(self.walk, self.hazard_ids + self.wood_ids, {self.hazard_ids[0]: {7}}))
        self.assertEqual([b["frame"] for b in out["hazards"][0]["frame_boxes"]], [7])
        self.assertEqual({f["visible_frames"] for f in out["structure_hazards"]}, {0})

    def test_the_truth_with_every_box_still_passes_the_house_check(self):
        visible = {"back-deck": {300}, self.hazard_ids[0]: {7}}
        out = self.attach(make_pass(self.walk, self.hazard_ids + self.wood_ids, visible))
        self.assertEqual(schema.errors(out, schema.load("house-truth")), [])
        house.validate(out, CATALOG, RULES)

    def test_the_input_truth_is_not_changed(self):
        before = copy.deepcopy(self.truth)
        self.attach(make_pass(self.walk, self.hazard_ids + self.wood_ids, {"back-deck": {1}}))
        self.assertEqual(self.truth, before)

    def refused(self, mask_pass, text, doc=None):
        with self.assertRaises(truth.MaskPassError) as caught:
            self.attach(mask_pass, doc)
        self.assertIn(text, str(caught.exception))

    def test_a_pass_with_no_box_entry_for_a_wood_finding_is_refused(self):
        self.refused(make_pass(self.walk, self.hazard_ids, {}), "boxes must name exactly")

    def test_the_refusal_names_every_id_the_pass_must_hold(self):
        bad = make_pass(self.walk, self.hazard_ids, {})
        with self.assertRaises(truth.MaskPassError) as caught:
            self.attach(bad)
        self.assertIn("back-deck", str(caught.exception))
        self.assertIn("front-porch", str(caught.exception))

    def test_a_pass_naming_a_structure_the_truth_does_not_hold_is_refused(self):
        spec = wood_hero("back-deck")
        house.roof_prisms(spec)
        one = house.truth_from_spec(spec, RULES)
        self.refused(make_pass(self.walk, self.hazard_ids + self.wood_ids, {}), "boxes must name exactly", one)

    def test_a_house_without_a_wood_finding_needs_no_extra_ids(self):
        spec = wood_hero()
        house.roof_prisms(spec)
        plain = house.truth_from_spec(spec, RULES)
        self.assertNotIn("structure_hazards", plain)
        out = self.attach(make_pass(self.walk, self.hazard_ids, {}), plain)
        self.assertNotIn("structure_hazards", out)

    def test_a_box_outside_the_image_on_a_wood_finding_is_refused(self):
        bad = make_pass(self.walk, self.hazard_ids + self.wood_ids, {"back-deck": {9}})
        bad["frames"][8]["boxes"]["back-deck"]["box_px"] = [0, 0, 5000, 5]
        self.refused(bad, "frame 9, back-deck")


class IdsAreOneNamespace(unittest.TestCase):
    def test_a_wood_structure_named_as_a_hazard_is_refused(self):
        doc = wood_hero("back-deck")
        next(s for s in doc["structures"] if s["id"] == "back-deck")["id"] = doc["hazards"][0]["id"]
        with self.assertRaises(house.HouseError) as caught:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(caught.exception.kind, "refused")
        self.assertIn("%s: id used by a hazard too" % doc["hazards"][0]["id"], str(caught.exception))

    def test_a_truth_wood_finding_named_as_a_hazard_is_refused(self):
        doc = wood_hero("back-deck")
        found = house.truth_from_spec(doc, RULES)
        found["structure_hazards"][0]["id"] = found["hazards"][0]["id"]
        with self.assertRaises(house.HouseError) as caught:
            house.validate(found, CATALOG, RULES)
        self.assertIn("id used by a hazard too", str(caught.exception))


class WriteHouseFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = wood_hero("back-deck")
        house.validate(cls.spec, CATALOG, RULES)
        house.roof_prisms(cls.spec)
        cls.walk, _ = route.build(cls.spec)
        cls.truth = house.truth_from_spec(cls.spec, RULES)
        cls.ids = [h["id"] for h in cls.truth["hazards"]] + ["back-deck"]

    def put(self, tmp, name, doc):
        path = os.path.join(tmp, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        return path

    def run_write(self, tmp, doc, *extra):
        out = os.path.join(tmp, "out")
        r = subprocess.run([sys.executable, WRITE, "--house", self.put(tmp, "spec.json", doc), "--out", out] + list(extra), capture_output=True, text=True)
        return r, out

    def test_a_house_spec_writes_its_truth_motion_and_parts(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, wood_hero("back-deck"))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(sorted(os.listdir(out)), ["motion.json", "parts.json", "truth.json"])
            written = support.load_json(os.path.join(out, "truth.json"))
            self.assertEqual(written, self.truth)
            self.assertEqual(support.load_json(os.path.join(out, "motion.json"))["frame_count"], self.walk["frame_count"])
            check = subprocess.run([sys.executable, CHECK, os.path.join(out, "truth.json")], capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)

    def test_changes_without_house_is_refused_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            spec = self.put(tmp, "spec.json", wood_hero("back-deck"))
            r = subprocess.run([sys.executable, WRITE, spec, "--out", out, "--changes", CHANGES], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2)
            self.assertIn("--changes needs --house", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_a_mask_pass_puts_the_boxes_in_the_truth_beside_the_wood_finding(self):
        with tempfile.TemporaryDirectory() as tmp:
            visible = {"back-deck": {1000, 1001}, self.ids[0]: {5}}
            r, out = self.run_write(tmp, wood_hero("back-deck"), "--mask-pass", self.put(tmp, "boxes.json", make_pass(self.walk, self.ids, visible)))
            self.assertEqual(r.returncode, 0, r.stderr)
            written = support.load_json(os.path.join(out, "truth.json"))
        self.assertEqual([b["frame"] for b in written["structure_hazards"][0]["frame_boxes"]], [1000, 1001])
        self.assertEqual([b["frame"] for b in written["hazards"][0]["frame_boxes"]], [5])
        self.assertIn("mask pass", written["visible_rule"])

    def test_a_pass_without_the_wood_finding_is_refused_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, wood_hero("back-deck"), "--mask-pass", self.put(tmp, "boxes.json", make_pass(self.walk, self.ids[:-1], {})))
            self.assertEqual(r.returncode, 3)
            self.assertIn("EW_ERROR mask pass: frame 1: boxes must name exactly", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_a_spec_the_house_check_refuses_writes_nothing(self):
        doc = wood_hero()
        doc["synthetic"] = False
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, doc)
            self.assertEqual(r.returncode, 2)
            self.assertIn("EW_ERROR house refused: synthetic must be true", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_the_changes_write_the_after_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, wood_hero(), "--changes", CHANGES)
            self.assertEqual(r.returncode, 0, r.stderr)
            written = support.load_json(os.path.join(out, "truth.json"))
        self.assertEqual(written["state"], "after")
        self.assertEqual([h["label"] for h in written["hazards"]], ["recommended"])


class AfterMaskPass(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.changes = support.load_json(CHANGES)
        cls.named = {h["id"]: h["change"] for h in cls.changes["hazards"]}
        after = house.after_spec(wood_hero(), cls.changes, CATALOG, RULES)
        house.roof_prisms(after)
        cls.walk, _ = route.build(after)
        cls.kept = [i for i, c in cls.named.items() if c == "kept"]
        cls.fixed = [i for i, c in cls.named.items() if c == "fixed"]
        cls.removed = [i for i, c in cls.named.items() if c == "removed"]

    def run_write(self, tmp, ids, visible):
        mask_pass = make_pass(self.walk, ids, visible)
        spec = os.path.join(tmp, "spec.json")
        with open(spec, "w", encoding="utf-8") as f:
            json.dump(wood_hero(), f)
        boxes = os.path.join(tmp, "boxes.json")
        with open(boxes, "w", encoding="utf-8") as f:
            json.dump(mask_pass, f)
        out = os.path.join(tmp, "out")
        r = subprocess.run([sys.executable, WRITE, "--house", spec, "--changes", CHANGES, "--mask-pass", boxes, "--out", out], capture_output=True, text=True)
        return r, out

    def test_the_hero_after_changes_keep_one_hazard_and_fix_five(self):
        self.assertEqual(self.kept, ["fence-at-siding"])
        self.assertEqual(len(self.fixed), 5)

    def test_a_pass_naming_the_kept_and_the_fixed_hazards_writes_the_kept_boxes_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            visible = {"fence-at-siding": {7, 8}, self.fixed[0]: {9}}
            r, out = self.run_write(tmp, self.kept + self.fixed, visible)
            self.assertEqual(r.returncode, 0, r.stderr)
            written = support.load_json(os.path.join(out, "truth.json"))
        self.assertEqual([h["id"] for h in written["hazards"]], self.kept)
        self.assertEqual([b["frame"] for b in written["hazards"][0]["frame_boxes"]], [7, 8])
        self.assertIn("mask pass", written["visible_rule"])

    def test_a_pass_naming_only_the_kept_hazard_still_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, self.kept, {"fence-at-siding": {3}})
            self.assertEqual(r.returncode, 0, r.stderr)
            written = support.load_json(os.path.join(out, "truth.json"))
        self.assertEqual([b["frame"] for b in written["hazards"][0]["frame_boxes"]], [3])

    def test_a_pass_naming_a_removed_hazard_is_refused_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, self.kept + self.fixed + self.removed[:1], {})
            self.assertEqual(r.returncode, 3)
            self.assertIn("EW_ERROR mask pass: frame 1: boxes must name exactly ['fence-at-siding']", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_a_pass_naming_an_id_changes_does_not_name_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, self.kept + self.fixed + ["ghost-pile"], {})
            self.assertEqual(r.returncode, 3)
            self.assertIn("boxes must name exactly ['fence-at-siding']", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_a_pass_without_the_kept_hazard_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, out = self.run_write(tmp, self.fixed, {})
            self.assertEqual(r.returncode, 3)
            self.assertIn("boxes must name exactly ['fence-at-siding']", r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_without_changes_a_pass_naming_extra_ids_is_still_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = wood_hero()
            path = os.path.join(tmp, "spec.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(spec, f)
            house.roof_prisms(spec)
            walk, _ = route.build(spec)
            ids = [h["id"] for h in house.truth_from_spec(spec, RULES)["hazards"]] + ["ghost-pile"]
            boxes = os.path.join(tmp, "boxes.json")
            with open(boxes, "w", encoding="utf-8") as f:
                json.dump(make_pass(walk, ids, {}), f)
            r = subprocess.run([sys.executable, WRITE, "--house", path, "--mask-pass", boxes, "--out", os.path.join(tmp, "out")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 3)


def blender(args):
    return subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1"] + args, capture_output=True, text=True, timeout=1800)


FLAT_COLOURS_ON_ANOTHER_DISPLAY = "\n".join([
    "import sys",
    "sys.path.insert(0, %r)",
    "import bpy",
    "from ewscene import blendmask",
    "scene = bpy.context.scene",
    'scene.display_settings.display_device = "Display P3"',
    "blendmask.flat_colours(scene)",
    'print("DISPLAY", scene.display_settings.display_device)',
    "",
])


@unittest.skipUnless(BLENDER, "Blender not found: the flat colour test did not run, so this is a PARTIAL RUN")
class FlatColours(unittest.TestCase):
    def test_the_flat_colours_are_read_through_the_srgb_display(self):
        r = blender(["--python-expr", FLAT_COLOURS_ON_ANOTHER_DISPLAY % support.BLENDER_DIR])
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertIn("DISPLAY sRGB", r.stdout)


@unittest.skipUnless(BLENDER, "Blender not found: the house mask pass test did not run, so this is a PARTIAL RUN")
class HouseMaskPass(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.spec = wood_hero("back-deck")
        cls.spec["structures"].append({"id": "far-deck", "kind": "deck", "material": "wood", "min_in": [1000, 900], "max_in": [1200, 1000], "height_in": 6})
        path = os.path.join(cls.tmp.name, "spec.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cls.spec, f)
        r = blender(["--python", BUILD_HOUSE, "--", path, "--out", cls.tmp.name])
        if r.returncode != 0:
            raise AssertionError("build failed: %s" % (r.stdout[-1500:] + r.stderr[-1500:]))
        blend = os.path.join(cls.tmp.name, "scene.blend")
        measured = os.path.join(cls.tmp.name, "measured.json")
        r = blender([blend, "--python", MEASURE, "--", "--out", measured, "--every", "4000"])
        if r.returncode != 0:
            raise AssertionError("measure failed: %s" % r.stderr[-2000:])
        cls.measured = support.load_json(measured)
        boxes = os.path.join(cls.tmp.name, "boxes.json")
        r = blender([blend, "--python", MASKS, "--", "--out", boxes, "--every", str(STEP)])
        if r.returncode != 0:
            raise AssertionError("mask pass failed: %s" % (r.stdout[-1500:] + r.stderr[-1500:]))
        cls.found = support.load_json(boxes)
        house.roof_prisms(cls.spec)
        cls.walk, _ = route.build(cls.spec)
        cls.truth = house.truth_from_spec(cls.spec, RULES)
        cls.ids = {h["id"] for h in cls.truth["hazards"] + cls.truth["structure_hazards"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_scene_marks_each_wood_finding_and_no_other_structure(self):
        self.assertEqual(set(self.measured["hazards"]), self.ids)
        deck = self.measured["hazards"]["back-deck"]
        self.assertEqual([round(v) for v in deck["min"] + deck["max"]], [120, 780, 0, 600, 924, 24])
        self.assertNotIn("far-deck", self.measured["hazards"])

    def test_the_pass_names_exactly_the_truth_ids_on_every_frame(self):
        self.assertEqual(len(self.ids), 16)
        self.assertEqual(sorted(self.found["indices"]), sorted(self.ids))
        self.assertEqual(sorted(self.found["indices"].values()), list(range(1, 17)))
        for f in self.found["frames"]:
            self.assertEqual(set(f["boxes"]), self.ids, f["frame"])

    def deck_region(self, frame):
        sample, cam = self.walk["samples"][frame - 1], self.walk["camera"]
        deck = next(s for s in self.spec["structures"] if s["id"] == "back-deck")
        corners = [(x, y, z) for x in (deck["min_in"][0], deck["max_in"][0]) for y in (deck["min_in"][1], deck["max_in"][1]) for z in (0, deck["height_in"])]
        seen = [geom.project(c, sample, cam) for c in corners]
        if None in seen:
            return None
        us, vs = [p[0] for p in seen], [p[1] for p in seen]
        return min(us), min(vs), max(us), max(vs)

    def test_the_wood_deck_shows_in_the_pass_where_the_deck_is_in_the_image(self):
        seen = [(f["frame"], f["boxes"]["back-deck"]) for f in self.found["frames"] if f["boxes"]["back-deck"]]
        self.assertGreaterEqual(len(seen), 2)
        for frame, hit in seen:
            left, top, right, bottom = hit["box_px"]
            self.assertTrue(0 <= left < right <= self.found["width"] and 0 <= top < bottom <= self.found["height"])
            self.assertGreaterEqual(hit["area_px"], maskbox.MIN_MASK_PX)
            region = self.deck_region(frame)
            if region is None:
                continue
            slack = 12
            self.assertTrue(left >= region[0] - slack and right <= region[2] + slack and top >= region[1] - slack and bottom <= region[3] + slack,
                            "frame %d: box %s lies outside the deck's projected region %s" % (frame, hit["box_px"], [round(v) for v in region]))

    def test_a_hazard_past_the_fourth_level_still_shows_with_its_own_level(self):
        shown = {i for f in self.found["frames"] for i, hit in f["boxes"].items() if hit}
        self.assertGreaterEqual(len({self.found["indices"][i] for i in shown if self.found["indices"][i] > 4}), 2)


if __name__ == "__main__":
    unittest.main()
