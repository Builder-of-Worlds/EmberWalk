import copy
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import unittest
import zlib
from struct import pack
from unittest import mock

import support
from ewscene import assets, chunks, engine, geom, house, route, schema, stills

BEFORE = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json")
CHANGES = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-after", "changes.json")
CHECK = os.path.join(support.BLENDER_DIR, "check_house.py")
BUILD_HOUSE = os.path.join(support.BLENDER_DIR, "build_house.py")
MEASURE = os.path.join(support.BLENDER_DIR, "measure_scene.py")
DUMP = os.path.join(support.BLENDER_DIR, "tests", "dump_house.py")
RENDER_FRAMES = os.path.join(support.BLENDER_DIR, "render_frames.py")
CHECK_STILLS = os.path.join(support.BLENDER_DIR, "check_stills.py")
BLENDER = support.blender_path()
CATALOG = assets.load_catalog()
RULES = house.load_rules()

SECTION_4_CONCEPTS = {
    "wood pile", "wooden fence", "roof debris", "foundation vent", "dry brush", "tree branch over roof",
    "shrub", "propane tank", "shed", "trash can", "patio furniture", "dry grass",
}


def before():
    return copy.deepcopy(support.load_json(BEFORE))


def changes():
    return copy.deepcopy(support.load_json(CHANGES))


def haz(doc, hazard_id):
    return next(h for h in doc["hazards"] if h["id"] == hazard_id)


def linear(hex_colour):
    out = []
    for i in (1, 3, 5):
        c = int(hex_colour[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def entry(doc, hazard_id):
    return next(e for e in doc["hazards"] if e["id"] == hazard_id)


def rule_for(concept, zone, statute):
    return next(i for i, r in sorted(RULES.items()) if r["concept"] == concept and r["zone"] == zone and r["statute"] == statute)


def check_args(doc, changes_doc=None):
    """Run the CLI on a document in a temporary folder; returns the result and what is left in the work folder."""
    with tempfile.TemporaryDirectory() as tmp:
        src, work = os.path.join(tmp, "in"), os.path.join(tmp, "work")
        os.makedirs(src)
        os.makedirs(work)
        argv = [sys.executable, CHECK, write(src, "doc.json", doc)]
        if changes_doc is not None:
            argv += ["--changes", write(src, "changes.json", changes_doc)]
        r = subprocess.run(argv, cwd=work, capture_output=True, text=True)
        return r, sorted(os.listdir(work)), sorted(os.listdir(src))


def write(folder, name, doc):
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc if isinstance(doc, str) else json.dumps(doc))
    return path


class Hero(unittest.TestCase):
    def test_the_before_spec_passes(self):
        doc = house.validate(before(), CATALOG, RULES)
        self.assertEqual((doc["schema"], doc["state"], doc["synthetic"], doc["label"]), ("emberwalk.house-spec/1", "before", True, "Synthetic sample house"))
        self.assertEqual(doc["house"]["area"], "State Responsibility Area")

    def test_every_section_4_hazard_is_listed(self):
        doc = before()
        self.assertTrue(SECTION_4_CONCEPTS <= {h["concept"] for h in doc["hazards"]})
        by_concept = {}
        for h in doc["hazards"]:
            by_concept.setdefault(h["concept"], []).append(h)
        self.assertEqual(sorted(h["band"] for h in by_concept["wood pile"]), ["0_5", "30_100"])
        self.assertEqual(len(by_concept["tree branch over roof"]), 2)
        self.assertEqual(haz(doc, "wood-pile-wall")["contact"], True)
        self.assertEqual(haz(doc, "fence-at-siding")["contact"], True)

    def test_the_demo_bar_is_met_in_whole_inches(self):
        doc = before()
        bands = [h["band"] for h in doc["hazards"]]
        self.assertGreaterEqual(bands.count("0_5"), 2)
        self.assertGreaterEqual(bands.count("30_100"), 1)
        for h in doc["hazards"]:
            self.assertIsInstance(h["distance_in"], int)

    def test_one_clean_side_and_the_front_are_stated(self):
        doc = before()
        clean = [name for name, side in doc["sides"].items() if side["clean"]]
        self.assertEqual(clean, ["back"])
        self.assertTrue(all(h["distance_in"] > 360 for h in doc["hazards"] if h["side"] == "back"))
        self.assertEqual(doc["front_door"]["side"], "front")
        self.assertEqual(doc["sides"]["front"]["facing"], "south")

    def test_the_look_and_route_blocks_are_there(self):
        doc = before()
        self.assertEqual(sorted(doc["look"]), ["concrete", "ground", "light", "roof", "siding", "trim"])
        self.assertEqual(doc["route"]["standoff_in"], 132)


class AfterScene(unittest.TestCase):
    def after(self):
        return house.after_spec(before(), changes(), CATALOG, RULES)

    def test_only_a_recommended_hazard_stays(self):
        after = self.after()
        self.assertEqual([h["id"] for h in after["hazards"]], ["fence-at-siding"])
        self.assertEqual(after["hazards"][0]["label"], "recommended")
        self.assertEqual((after["state"], after["id"]), ("after", "hero-after"))

    def test_every_required_now_hazard_is_removed_or_fixed(self):
        doc = before()
        after = self.after()
        required = {h["id"] for h in doc["hazards"] if h["label"] == "required_now"}
        gone = {h["id"] for h in after["hazards"]}
        self.assertFalse(required & gone)
        for hazard_id in required:
            self.assertIn(entry(changes(), hazard_id)["change"], ("removed", "fixed"))

    def test_fixed_objects_take_the_new_placement_and_keep_the_rest(self):
        doc = before()
        fixed = {f["id"]: f for f in self.after()["fixed"]}
        self.assertEqual(sorted(fixed), ["branch-over-roof-left", "propane-tank-right", "shed-right", "tall-grass-back", "wood-pile-wall"])
        pile = fixed["wood-pile-wall"]
        self.assertEqual((pile["distance_in"], pile["along_in"], pile["contact"]), (540, 300, False))
        self.assertEqual(pile["size_in"], haz(doc, "wood-pile-wall")["size_in"])
        self.assertEqual(fixed["tall-grass-back"]["size_in"], [300, 240, 3])
        self.assertEqual(fixed["tall-grass-back"]["distance_in"], haz(doc, "tall-grass-back")["distance_in"])

    def test_nothing_but_hazards_changes(self):
        doc, after = before(), self.after()
        for key in doc:
            if key not in ("hazards", "id", "state"):
                self.assertEqual(doc[key], after[key], key)

    def test_the_before_spec_is_not_touched(self):
        doc = before()
        house.after_spec(doc, changes(), CATALOG, RULES)
        self.assertEqual(doc, before())

    def test_the_after_spec_passes_the_check_without_the_demo_bar(self):
        house.validate(self.after(), CATALOG, RULES)

    def test_a_tampered_after_spec_is_refused(self):
        after = self.after()
        after["look"]["light"]["rotation_deg"] = 10
        with self.assertRaises(house.HouseError) as ctx:
            house.check_after(before(), after)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("may change only hazards", str(ctx.exception))
        self.assertIn("look", str(ctx.exception))


class TruthFromSpec(unittest.TestCase):
    def test_the_truth_passes_and_carries_the_fields(self):
        truth = house.truth_from_spec(before())
        house.validate(truth, CATALOG, RULES)
        by_id = {h["id"]: h for h in truth["hazards"]}
        self.assertEqual((truth["schema"], truth["scene"], truth["state"]), ("emberwalk.house-truth/1", "hero-before", "before"))
        grass = by_id["tall-grass-back"]
        self.assertEqual((grass["distance_ft"], grass["distance_text"], grass["band"]), (50.0, "50 ft 0 in", "30_100"))
        self.assertEqual(grass["box_in"], {"min": [150, 600, 0], "max": [450, 840, 30]})
        gutter = by_id["gutter-leaves-front"]
        self.assertEqual((gutter["box_in"]["min"][2], gutter["box_in"]["max"][2]), (104, 109))
        self.assertEqual(by_id["wood-pile-wall"]["distance_text"], "0 ft 0 in")
        self.assertEqual(truth["sides"], before()["sides"])
        self.assertEqual(truth["footprint"], before()["footprint"])

    def test_the_after_truth_passes(self):
        after = house.after_spec(before(), changes(), CATALOG, RULES)
        truth = house.truth_from_spec(after)
        house.validate(truth, CATALOG, RULES)
        self.assertEqual([h["id"] for h in truth["hazards"]], ["fence-at-siding"])


class Invalid(unittest.TestCase):
    def assertInvalid(self, doc, words):
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn(words, str(ctx.exception))
        r, left, _ = check_args(doc)
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertEqual(left, [])

    def test_an_unknown_route_setting(self):
        doc = before()
        doc["route"]["sprint"] = 1
        self.assertInvalid(doc, "$.route: unknown key sprint")

    def test_a_route_standoff_outside_120_to_144_in(self):
        doc = before()
        doc["route"]["standoff_in"] = 150
        self.assertInvalid(doc, "$.route.standoff_in: above 144")

    def test_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(tmp, "spec.json", '{"schema": "emberwalk.house-spec/1", ')
            with self.assertRaises(house.HouseError) as ctx:
                house.load_json(path)
            self.assertEqual(ctx.exception.kind, "invalid")
        r, left, _ = check_args('{"schema": ')
        self.assertEqual(r.returncode, 3)
        self.assertEqual(left, [])
        self.assertIn("EW_ERROR", r.stderr)

    def test_a_missing_file(self):
        with self.assertRaises(house.HouseError) as ctx:
            house.load_json("/nonexistent/spec.json")
        self.assertEqual(ctx.exception.kind, "invalid")

    def test_not_an_object(self):
        self.assertInvalid([], "not an object")

    def test_missing_hazards(self):
        doc = before()
        del doc["hazards"]
        self.assertInvalid(doc, "missing hazards")

    def test_missing_rule_id(self):
        doc = before()
        del doc["hazards"][0]["rule_id"]
        self.assertInvalid(doc, "hazards[0]: missing rule_id")

    def test_missing_look(self):
        doc = before()
        del doc["look"]
        self.assertInvalid(doc, "missing look")

    def test_a_concrete_look_with_no_tint(self):
        doc = before()
        del doc["look"]["concrete"]["tint"]
        self.assertInvalid(doc, "$.look.concrete: missing tint")

    def test_clouds_covering_more_than_the_whole_sky(self):
        doc = before()
        doc["look"]["light"]["sky"]["clouds"]["cover"] = 1.2
        self.assertInvalid(doc, "$.look.light.sky.clouds.cover: above 1")

    def test_a_zenith_at_the_horizon(self):
        doc = before()
        doc["look"]["light"]["sky"]["zenith_at"] = 0
        self.assertInvalid(doc, "$.look.light.sky.zenith_at")

    def test_missing_side(self):
        doc = before()
        del doc["sides"]["back"]
        self.assertInvalid(doc, "missing back")

    def test_wrong_schema_string(self):
        doc = before()
        doc["schema"] = "emberwalk.scene-spec/1"
        self.assertInvalid(doc, "emberwalk.scene-spec/1")

    def test_the_old_one_side_truth_is_not_a_house(self):
        doc = support.fixture("truth.json")
        self.assertInvalid(doc, "emberwalk.truth/1")

    def test_unknown_key(self):
        doc = before()
        doc["hazards"][0]["colour"] = "red"
        self.assertInvalid(doc, "unknown key colour")

    def test_distance_not_whole_inches(self):
        doc = before()
        doc["hazards"][0]["distance_in"] = 2.5
        self.assertInvalid(doc, "hazards[0].distance_in")

    def test_front_door_must_be_on_the_front(self):
        doc = before()
        doc["front_door"]["side"] = "back"
        self.assertInvalid(doc, "front_door.side")

    def test_a_side_facing_the_wrong_way(self):
        doc = before()
        doc["sides"]["front"]["facing"] = "north"
        self.assertInvalid(doc, "sides.front.facing")

    def test_a_side_length_that_disagrees_with_the_footprint(self):
        doc = before()
        doc["sides"]["back"]["length_in"] += 12
        self.assertInvalid(doc, "sides.back.length_in is 732, the footprint side is 720")

    def test_a_side_entry_of_the_wrong_shape(self):
        doc = before()
        doc["sides"]["garage"]["length_in"] = "30 ft"
        self.assertInvalid(doc, "sides.garage.length_in")

    def test_a_side_entry_with_an_unknown_key(self):
        doc = before()
        doc["sides"]["left"]["colour"] = "red"
        self.assertInvalid(doc, "sides.left: unknown key colour")

    def test_a_side_that_is_not_in_the_footprint(self):
        doc = before()
        doc["sides"]["porch"] = dict(doc["sides"]["front"])
        self.assertInvalid(doc, "porch is not in the footprint")

    def test_a_footprint_side_named_twice(self):
        doc = before()
        doc["footprint"][1]["side"] = "left"
        self.assertInvalid(doc, "named twice")

    def test_a_slanted_side(self):
        doc = before()
        doc["footprint"][2]["start_in"] = [700, 780]
        self.assertInvalid(doc, "does not run north, south, east or west")

    def test_an_anticlockwise_footprint(self):
        doc = before()
        doc["footprint"].reverse()
        self.assertInvalid(doc, "anticlockwise")

    def test_a_flat_footprint_that_encloses_no_area(self):
        doc = before()
        corners = [[0, 0], [0, 390], [0, 780], [0, 390]]
        doc["footprint"] = [{"side": name, "start_in": c} for name, c in zip(("left", "back", "right", "front"), corners)]
        self.assertInvalid(doc, "footprint: the ring encloses no area")

    def test_a_footprint_that_crosses_itself(self):
        doc = before()
        corners = [[0, 0], [0, 300], [300, 300], [300, 100], [100, 100], [100, 200], [400, 200], [400, 0]]
        doc["footprint"] = [{"side": name, "start_in": c} for name, c in zip("abcdefgh", corners)]
        self.assertInvalid(doc, "cross")

    def test_a_footprint_away_from_the_origin(self):
        doc = before()
        for entry_ in doc["footprint"]:
            entry_["start_in"] = [entry_["start_in"][0] + 12, entry_["start_in"][1]]
        self.assertInvalid(doc, "south west corner")

    def test_no_side_named_front(self):
        doc = before()
        doc["footprint"][3]["side"] = "entry"
        doc["sides"]["entry"] = doc["sides"].pop("front")
        self.assertInvalid(doc, "no side is named front")

    def test_a_chimney_past_its_wall_end(self):
        doc = before()
        doc["house"]["features"]["chimney"]["along_in"] = 470
        self.assertInvalid(doc, "chimney: runs past the wall end")

    def test_a_structure_with_min_and_max_swapped(self):
        doc = before()
        s = doc["structures"][0]
        s["min_in"], s["max_in"] = s["max_in"], s["min_in"]
        self.assertInvalid(doc, "min_in must be south west of max_in")

    def test_a_hazard_running_past_the_wall_end(self):
        doc = before()
        haz(doc, "patio-furniture-front")["along_in"] = 700
        self.assertInvalid(doc, "runs past the wall end")

    def test_the_front_door_past_the_wall_end(self):
        doc = before()
        doc["front_door"]["along_in"] = 710
        self.assertInvalid(doc, "front_door")

    def test_an_after_spec_without_fixed_objects_shape(self):
        doc = house.after_spec(before(), changes(), CATALOG, RULES)
        doc["fixed"][0]["size_in"] = [1, 2]
        self.assertInvalid(doc, "fixed[0].size_in")

    def test_changes_with_the_wrong_schema_string(self):
        c = changes()
        c["schema"] = "emberwalk.house-spec/1"
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        r, left, _ = check_args(before(), c)
        self.assertEqual((r.returncode, left), (3, []))

    def test_changes_missing_a_field(self):
        c = changes()
        del entry(c, "shed-right")["change"]
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("missing change", str(ctx.exception))

    def test_changes_not_an_object(self):
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), [], CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")

    def test_changes_with_a_whole_inch_violation(self):
        c = changes()
        entry(c, "shed-right")["distance_in"] = 40.5
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")

    def test_a_fixed_entry_with_no_new_placement(self):
        c = changes()
        entry(c, "shed-right").pop("distance_in")
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("no new placement", str(ctx.exception))


class Refused(unittest.TestCase):
    def assertRefused(self, doc, words, changes_doc=None):
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn(words, str(ctx.exception))
        r, left, inputs = check_args(doc, changes_doc)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn(words, r.stderr)
        self.assertNotIn("HOUSE OK", r.stdout)
        self.assertEqual(left, [])
        self.assertEqual(inputs, ["doc.json"] if changes_doc is None else ["changes.json", "doc.json"])

    def test_missing_synthetic_flag(self):
        doc = before()
        del doc["synthetic"]
        self.assertRefused(doc, "synthetic")

    def test_synthetic_false(self):
        doc = before()
        doc["synthetic"] = False
        self.assertRefused(doc, "synthetic")

    def test_missing_label(self):
        doc = before()
        del doc["label"]
        self.assertRefused(doc, "Synthetic sample house")

    def test_wrong_label(self):
        doc = before()
        doc["label"] = "Sample house"
        self.assertRefused(doc, "Synthetic sample house")

    def test_hazard_past_100_feet(self):
        doc = before()
        haz(doc, "wood-pile-far-left")["distance_in"] = 1201
        self.assertRefused(doc, "past 100 feet")

    def test_hazard_at_exactly_100_feet_passes(self):
        doc = before()
        haz(doc, "wood-pile-far-left")["distance_in"] = 1200
        house.validate(doc, CATALOG, RULES)

    def test_negative_distance(self):
        doc = before()
        haz(doc, "dry-plants-garage-side")["distance_in"] = -1
        self.assertRefused(doc, "negative distance")

    def test_band_that_disagrees_with_the_distance(self):
        doc = before()
        haz(doc, "dry-plants-garage-side")["band"] = "5_30"
        self.assertRefused(doc, "band 5_30")

    def test_the_5_foot_edge_is_in_the_first_band(self):
        doc = before()
        haz(doc, "patio-furniture-front")["distance_in"] = 60
        house.validate(doc, CATALOG, RULES)

    def test_one_inch_past_5_feet_is_not_the_first_band(self):
        doc = before()
        haz(doc, "patio-furniture-front")["distance_in"] = 61
        self.assertRefused(doc, "band 0_5")

    def test_contact_on_a_hazard_away_from_the_wall(self):
        doc = before()
        haz(doc, "trash-cans-right")["contact"] = True
        self.assertRefused(doc, "contact")

    def test_side_not_in_the_house(self):
        doc = before()
        haz(doc, "shed-right")["side"] = "patio"
        self.assertRefused(doc, "side patio")

    def test_duplicate_id(self):
        doc = before()
        doc["hazards"][1]["id"] = doc["hazards"][0]["id"]
        self.assertRefused(doc, "used twice")

    def test_asset_not_in_assets_json(self):
        doc = before()
        haz(doc, "wood-pile-wall")["asset"] = "polyhaven:not_a_cleared_asset"
        self.assertRefused(doc, "unknown asset")

    def test_asset_for_another_concept(self):
        doc = before()
        haz(doc, "wood-pile-wall")["asset"] = "scripted:wood_fence"
        self.assertRefused(doc, "is not a wood pile")

    def test_material_not_in_assets_json(self):
        doc = before()
        doc["look"]["siding"]["material"] = "sketchfab:siding"
        self.assertRefused(doc, "unknown asset")

    def test_texture_used_as_light(self):
        doc = before()
        doc["look"]["light"]["hdri"] = "polyhaven:withered_grass"
        self.assertRefused(doc, "is not a hdri")

    def test_a_concrete_texture_not_in_assets_json(self):
        doc = before()
        doc["look"]["concrete"]["material"] = "sketchfab:concrete"
        self.assertRefused(doc, "look.concrete.material: unknown asset sketchfab:concrete")

    def test_a_light_used_as_the_concrete_texture(self):
        doc = before()
        doc["look"]["concrete"]["material"] = "polyhaven:goegap"
        self.assertRefused(doc, "look.concrete.material: polyhaven:goegap is not a texture")

    def test_rule_id_the_package_does_not_have(self):
        doc = before()
        haz(doc, "wood-pile-wall")["rule_id"] = "ca-wood-pile-made-up-z0"
        self.assertRefused(doc, "not in the rules package")

    def test_a_real_rule_id_passes_and_a_made_up_one_does_not(self):
        real = rule_for("wood_pile", "zone_0", None)
        self.assertIn(real, RULES)
        doc = before()
        haz(doc, "wood-pile-wall")["rule_id"] = real
        house.validate(doc, CATALOG, RULES)
        haz(doc, "wood-pile-wall")["rule_id"] = real + "-made-up"
        with self.assertRaises(house.HouseError):
            house.validate(doc, CATALOG, RULES)

    def test_rule_id_for_another_concept(self):
        doc = before()
        haz(doc, "wood-pile-wall")["rule_id"] = rule_for("dry_brush", "zone_0", None)
        self.assertRefused(doc, "is for dry_brush, not wood pile")

    def test_rule_id_for_another_zone(self):
        doc = before()
        haz(doc, "wood-pile-wall")["rule_id"] = rule_for("wood_pile", "zone_1", None)
        self.assertRefused(doc, "zone_1")

    def test_very_high_zone_rule_id(self):
        doc = before()
        haz(doc, "gutter-leaves-front")["rule_id"] = rule_for("roof_debris", "zone_0", "vhfhsz")
        self.assertRefused(doc, "Very High")

    def test_the_state_responsibility_rule_passes(self):
        doc = before()
        haz(doc, "gutter-leaves-front")["rule_id"] = rule_for("roof_debris", "zone_0", "sra")
        house.validate(doc, CATALOG, RULES)

    def test_clean_side_with_a_hazard_within_30_feet(self):
        doc = before()
        haz(doc, "trash-cans-right")["side"] = "back"
        self.assertRefused(doc, "clean side back")

    def test_clean_side_with_a_hazard_at_exactly_30_feet(self):
        doc = before()
        h = haz(doc, "tall-grass-back")
        h["distance_in"], h["band"] = 360, "5_30"
        h["rule_id"] = rule_for("dry_grass", "zone_1", None)
        self.assertRefused(doc, "clean side back")

    def test_clean_side_with_a_hazard_just_past_30_feet_passes(self):
        doc = before()
        haz(doc, "tall-grass-back")["distance_in"] = 361
        house.validate(doc, CATALOG, RULES)

    def test_fewer_than_two_hazards_in_the_first_5_feet(self):
        doc = before()
        doc["hazards"] = [h for h in doc["hazards"] if h["band"] != "0_5" or h["id"] == "wood-pile-wall"]
        self.assertRefused(doc, "fewer than two")

    def test_no_hazard_past_30_feet(self):
        doc = before()
        doc["hazards"] = [h for h in doc["hazards"] if h["band"] != "30_100"]
        self.assertRefused(doc, "no hazard in 30_100")

    def test_truth_band_that_disagrees(self):
        truth = house.truth_from_spec(before())
        truth["hazards"][0]["band"] = "30_100"
        self.assertRefused(truth, "band 30_100")

    def test_truth_rule_id_the_package_does_not_have(self):
        truth = house.truth_from_spec(before())
        truth["hazards"][0]["rule_id"] = "ca-not-a-rule-z0"
        self.assertRefused(truth, "not in the rules package")

    def test_truth_missing_synthetic(self):
        truth = house.truth_from_spec(before())
        del truth["synthetic"]
        self.assertRefused(truth, "synthetic")

    def test_truth_contact_away_from_the_wall(self):
        truth = house.truth_from_spec(before())
        next(h for h in truth["hazards"] if h["id"] == "shed-right")["contact"] = True
        self.assertRefused(truth, "contact")

    def test_truth_clean_side_with_a_hazard(self):
        truth = house.truth_from_spec(before())
        next(h for h in truth["hazards"] if h["id"] == "trash-cans-right")["side"] = "back"
        self.assertRefused(truth, "clean side back")

    def test_truth_past_100_feet(self):
        truth = house.truth_from_spec(before())
        next(h for h in truth["hazards"] if h["id"] == "wood-pile-far-left")["distance_in"] = 1300
        self.assertRefused(truth, "past 100 feet")

    def test_truth_with_the_after_demo_bar_off_and_before_on(self):
        truth = house.truth_from_spec(before())
        truth["hazards"] = [h for h in truth["hazards"] if h["band"] != "30_100"]
        self.assertRefused(truth, "no hazard in 30_100")


def u_house(notch_w=240):
    """The hero spec on a U footprint opening south, the notch notch_w wide from x 240, with no roof, structures, hazards, windows or garage door."""
    doc = before()
    east = 240 + notch_w
    corners = [("left", [0, 0]), ("back", [0, 600]), ("right", [720, 600]), ("front", [720, 0]),
               ("east_arm", [east, 0]), ("notch_back", [east, 360]), ("west_arm", [240, 360]), ("front_left", [240, 0])]
    doc["footprint"] = [{"side": name, "start_in": c} for name, c in corners]
    doc["sides"] = {e["side"]: {"length_in": e["length_in"], "height_in": 108, "facing": e["facing"], "clean": False} for e in house.edges(doc)}
    doc["front_door"]["along_in"] = 40
    doc["structures"], doc["hazards"] = [], []
    del doc["house"]["roof"], doc["house"]["features"]["windows"], doc["house"]["features"]["garage_door"]
    return doc


class RefusedFootprint(unittest.TestCase):
    assertRefused = Refused.assertRefused

    def test_a_structure_running_into_the_house(self):
        doc = before()
        doc["structures"][0]["min_in"] = [300, 204]
        self.assertRefused(doc, "front-porch: runs into the house")

    def test_a_structure_outside_the_lot(self):
        doc = before()
        struct(doc, "road")["min_in"] = [-1500, -1600]
        self.assertRefused(doc, "road: runs outside the lot")

    def test_a_structure_id_used_twice(self):
        doc = before()
        doc["structures"][1]["id"] = "front-porch"
        self.assertRefused(doc, "front-porch: id used twice")

    def test_a_house_outside_its_lot(self):
        doc = before()
        doc["lot"]["max_in"] = [600, 2280]
        self.assertRefused(doc, "the house is not inside the lot")

    def test_a_hazard_box_outside_the_lot(self):
        doc = before()
        doc["lot"]["min_in"][0] = -740
        struct(doc, "road")["min_in"][0] = -740
        self.assertRefused(doc, "wood-pile-far-left: its box runs outside the lot")

    def test_a_vent_on_a_side_the_house_does_not_have(self):
        doc = before()
        doc["house"]["features"]["foundation_vents"][0]["side"] = "porch"
        self.assertRefused(doc, "side porch is not in the house")

    def test_a_hazard_box_running_into_the_far_arm_of_a_u(self):
        doc = u_house()
        doc["hazards"] = [dict(haz(before(), "shed-right"), side="west_arm", along_in=100, distance_in=200)]
        self.assertRefused(doc, "shed-right: its box runs into the house")

    def test_the_same_hazard_inside_the_notch_clears_the_house(self):
        doc = u_house()
        doc["hazards"] = [dict(haz(before(), "shed-right"), side="west_arm", along_in=100, distance_in=100)]
        self.assertRefused(doc, "fewer than two")


class Footprint(unittest.TestCase):
    def test_the_hero_is_an_l_with_the_garage_out_front(self):
        eds = house.edges(before())
        self.assertEqual([(e["side"], e["facing"], e["length_in"]) for e in eds], [
            ("left", "west", 780), ("back", "north", 720), ("right", "east", 480),
            ("front", "south", 360), ("garage_side", "east", 300), ("garage", "south", 360)])

    def test_a_box_is_placed_from_the_start_corner_out_from_the_wall(self):
        eds = {e["side"]: e for e in house.edges(before())}
        self.assertEqual(house.plan_rect(eds["left"], 200, 0, 96, 24), (-24, 200, 0, 296))
        self.assertEqual(house.plan_rect(eds["front"], 60, 30, 72, 30), (588, 240, 660, 270))
        self.assertEqual(house.plan_rect(eds["garage_side"], 100, 18, 96, 36), (378, 104, 414, 200))

    def test_a_box_touching_a_wall_is_clear_and_one_across_it_is_not(self):
        eds = house.edges(before())
        self.assertFalse(house.overlaps_house((-24, 200, 0, 296), eds))
        self.assertFalse(house.overlaps_house((400, 0, 700, 300), eds))
        self.assertTrue(house.overlaps_house((-24, 200, 1, 296), eds))
        self.assertTrue(house.overlaps_house((100, 100, 200, 200), eds))
        self.assertTrue(house.overlaps_house((-100, -100, 900, 900), eds))

    def test_a_box_inside_the_house_level_with_a_corner_is_inside(self):
        eds = house.edges(before())
        self.assertTrue(house.overlaps_house((50, 250, 150, 350), eds))
        self.assertFalse(house.overlaps_house((750, 250, 850, 350), eds))

    def test_the_porch_sits_beside_the_garage_and_the_deck_off_the_back(self):
        doc = before()
        by_id = {s["id"]: s for s in doc["structures"]}
        self.assertEqual(by_id["front-porch"]["max_in"][1], 300)
        self.assertGreater(by_id["front-porch"]["min_in"][0], 360)
        self.assertEqual(by_id["back-deck"]["min_in"][1], 780)
        self.assertEqual((by_id["driveway"]["max_in"][1], by_id["driveway"]["min_in"][0] >= 0, by_id["driveway"]["max_in"][0] <= 360), (0, True, True))
        self.assertEqual(haz(doc, "patio-furniture-front")["elevation_in"], by_id["front-porch"]["height_in"])


def tuft_verts(tufts):
    return [p for t in tufts for b in t["blades"] for p in b]


class GroundCover(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = before()
        cls.tufts = route.ground_cover(cls.doc)
        cls.eds = house.edges(cls.doc)

    def test_the_hero_gets_hundreds_of_tufts_the_same_every_time(self):
        self.assertGreaterEqual(len(self.tufts), 500)
        self.assertEqual(route.ground_cover(before()), self.tufts)

    def test_tufts_grow_on_every_side_of_the_house_and_no_further_than_their_reach(self):
        xs, ys = [e["start"][0] for e in self.eds], [e["start"][1] for e in self.eds]
        reach, size = route.TUFT_REACH_IN, route.TUFT_IN
        at = [t["at_in"] for t in self.tufts]
        self.assertTrue(any(x + size < min(xs) for x, _ in at) and any(x > max(xs) for x, _ in at))
        self.assertTrue(any(y + size < min(ys) for _, y in at) and any(y > max(ys) for _, y in at))
        for x, y in at:
            self.assertTrue(min(xs) - reach <= x and x + size <= max(xs) + reach, x)
            self.assertTrue(min(ys) - reach <= y and y + size <= max(ys) + reach, y)

    def test_no_tuft_is_in_the_house_a_structure_or_a_hazard_box_or_on_the_walk(self):
        ring = house.loop(self.doc, route.params(self.doc)["standoff_in"])
        boxes = list(route.hazard_boxes(self.doc).values())
        rects = [s["min_in"] + s["max_in"] for s in self.doc["structures"]]
        clear = route.HAZARD_CLEAR_IN - 0.01
        for x, y, _ in tuft_verts(self.tufts):
            self.assertFalse(house._inside(self.eds, x, y), (x, y))
            self.assertFalse(any(r[0] < x < r[2] and r[1] < y < r[3] for r in rects), (x, y))
            self.assertFalse(any(b[0] - clear < x < b[3] + clear and b[1] - clear < y < b[4] + clear for b in boxes), (x, y))
            self.assertGreaterEqual(house._ring_dist((x, y), ring), route.WALK_CLEAR_IN - 0.01, (x, y))

    def test_each_blade_rises_in_its_tuft_square_and_leans_north_east(self):
        low, high = route.TUFT_HEIGHT_IN
        for t in self.tufts:
            (x, y), size = t["at_in"], route.TUFT_IN
            self.assertEqual(len(t["blades"]), route.TUFT_BLADES)
            self.assertTrue(low <= t["tall_in"] <= high)
            for a, b, tip in t["blades"]:
                self.assertEqual((a[2], b[2], a[1]), (0, 0, b[1]))
                self.assertAlmostEqual(b[0] - a[0], route.BLADE_IN)
                self.assertTrue(tip[0] >= a[0] and tip[1] >= a[1], (a, tip))
                self.assertTrue(0.6 * t["tall_in"] - 0.01 <= tip[2] <= t["tall_in"], (t["tall_in"], tip))
                for p in (a, b, tip):
                    self.assertTrue(x <= p[0] <= x + size and y <= p[1] <= y + size, (t["at_in"], p))

    def test_no_tuft_crosses_the_lot_edge(self):
        doc = before()
        doc["lot"]["max_in"][0] = 1100
        road = struct(doc, "road")
        road["max_in"][0] = 1100
        tufts = route.ground_cover(doc)
        self.assertTrue(any(t["at_in"][0] > 1000 for t in tufts))
        for x, y, _ in tuft_verts(tufts):
            self.assertLessEqual(x, 1100)

    def test_the_after_scene_grows_tufts_where_removed_hazards_stood(self):
        after = house.after_spec(before(), changes(), CATALOG, RULES)
        gone = [b for hid, b in route.hazard_boxes(before()).items() if hid not in route.hazard_boxes(after)]
        verts = tuft_verts(route.ground_cover(after))
        self.assertTrue(any(b[0] < x < b[3] and b[1] < y < b[4] for x, y, _ in verts for b in gone))


class Loop(unittest.TestCase):
    def test_the_hero_loop_is_the_l_offset_by_the_standoff(self):
        ring = house.loop(before(), 132)
        self.assertEqual([o["start"] for o in ring], [(-132, -132), (-132, 912), (852, 912), (852, 168), (492, 168), (492, -132)])
        self.assertEqual(house.loop_length_in(before(), 132), 4056)

    def test_each_loop_side_runs_beside_its_wall(self):
        for name in ("hero", "mobile", "apartment"):
            doc = spec_of(name)
            for e, o in zip(house.edges(doc), house.loop(doc, 132)):
                self.assertEqual((e["side"], e["u"]), (o["side"], o["u"]))
                gap = (o["start"][0] - e["start"][0]) * e["n"][0] + (o["start"][1] - e["start"][1]) * e["n"][1]
                self.assertEqual(gap, 132, (name, e["side"]))

    def test_the_standoff_bounds(self):
        house.loop(before(), 120)
        house.loop(before(), 144)
        for bad in (119, 145):
            with self.assertRaises(house.HouseError) as ctx:
                house.loop(before(), bad)
            self.assertEqual(ctx.exception.kind, "refused")
            self.assertIn("outside 120 to 144", str(ctx.exception))

    def test_a_loop_that_leaves_the_lot(self):
        doc = before()
        doc["lot"]["max_in"][1] = 900
        with self.assertRaises(house.HouseError) as ctx:
            house.loop(doc, 132)
        self.assertIn("leaves the lot", str(ctx.exception))

    def test_a_notch_too_narrow_to_walk_into(self):
        house.loop(u_house(300), 132)
        with self.assertRaises(house.HouseError) as ctx:
            house.loop(u_house(200), 132)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("folds over itself", str(ctx.exception))

    def test_the_walk_starts_at_the_front_door(self):
        self.assertEqual(house.door_point(before(), 132), [558.0, 168.0])
        self.assertEqual(house.door_point(spec_of("apartment"), 132), [540.0, -132.0])

    def test_a_pan_from_every_corner_and_every_side(self):
        counts = {name: len(house.pans(spec_of(name), 132)) for name in ("hero", "mobile", "apartment")}
        self.assertEqual(counts, {"hero": 12, "mobile": 8, "apartment": 12})

    def test_the_hero_pans_run_on_from_the_front_door_and_look_outward(self):
        p = house.pans(before(), 132)
        self.assertEqual((p[0]["kind"], p[0]["sides"], p[0]["bearing_deg"], p[0]["at_in"]), ("corner", ["front", "garage_side"], 135, [492, 168]))
        self.assertEqual((p[-1]["kind"], p[-1]["side"], p[-1]["bearing_deg"], p[-1]["at_in"]), ("side", "front", 180, [672.0, 168.0]))
        self.assertEqual([x["bearing_deg"] for x in p if x["kind"] == "corner"], [135, 135, 225, 315, 45, 135])
        self.assertEqual([x["side"] for x in p if x["kind"] == "side"], ["garage_side", "garage", "left", "back", "right", "front"])

    def test_a_door_past_the_front_middle_leaves_that_pan_for_last(self):
        p = house.pans(spec_of("mobile"), 132)
        self.assertEqual((p[0]["kind"], p[-1]["kind"], p[-1]["side"]), ("corner", "side", "front"))

    def test_a_door_before_the_front_middle_pans_the_front_first(self):
        p = house.pans(spec_of("apartment"), 132)
        self.assertEqual(house.door_point(spec_of("apartment"), 132), [540.0, -132.0])
        self.assertEqual((p[0]["kind"], p[0]["side"], p[0]["at_in"]), ("side", "front", [480.0, -132.0]))
        self.assertEqual((p[-1]["kind"], p[-1]["sides"]), ("corner", ["right", "front"]))


def spec_of(name):
    return copy.deepcopy(support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", name + "-before", "spec.json")))


def changes_of(name):
    return copy.deepcopy(support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", name + "-after", "changes.json")))


class ThreeHouses(unittest.TestCase):
    def test_each_house_and_its_after_scene_pass(self):
        for name in ("hero", "mobile", "apartment"):
            after = house.after_spec(house.validate(spec_of(name), CATALOG, RULES), changes_of(name), CATALOG, RULES)
            self.assertFalse([h for h in after["hazards"] if h["label"] == "required_now"], name)
            self.assertTrue([h for h in after["hazards"] if h["label"] == "recommended"], name)
            self.assertEqual(after["id"], name + "-after")

    def test_every_house_has_a_window_on_every_side_on_every_storey_and_a_front_and_back_door(self):
        for name in ("hero", "mobile", "apartment"):
            doc = house.validate(spec_of(name), CATALOG, RULES)
            storey_in = doc["sides"]["front"]["height_in"] / doc["house"]["storeys"]
            for side in ("front", "back", "left", "right"):
                sills = [w["sill_in"] for w in doc["house"]["features"]["windows"] if w["side"] == side]
                for storey in range(doc["house"]["storeys"]):
                    self.assertTrue([z for z in sills if storey * storey_in <= z < (storey + 1) * storey_in], (name, side, storey))
            self.assertEqual((doc["front_door"]["side"], doc["back_door"]["side"]), ("front", "back"), name)
            self.assertEqual(schema.errors(doc, schema.load("house-spec")), [], name)

    def test_the_three_are_a_double_wide_an_l_ranch_and_a_six_unit_building(self):
        styles = {name: (spec_of(name)["house"]["style"], spec_of(name)["house"]["dwelling_units"], len(spec_of(name)["footprint"]))
                  for name in ("hero", "mobile", "apartment")}
        self.assertEqual(styles, {"hero": ("one storey ranch", 1, 6), "mobile": ("double wide mobile home", 1, 4), "apartment": ("apartment building", 6, 6)})

    def test_the_three_footprints_differ(self):
        shapes = set()
        for name in ("hero", "mobile", "apartment"):
            shapes.add(tuple((e["facing"], e["length_in"]) for e in house.edges(spec_of(name))))
        self.assertEqual(len(shapes), 3)

    def test_the_apartment_is_a_long_bar_with_a_wing_behind_unlike_the_hero(self):
        def shape(doc):
            eds = house.edges(doc)
            width = max(e["start"][0] for e in eds)
            front = doc["sides"]["front"]["length_in"]
            return front == width, [e["side"] for e in eds if e["facing"] == "north"]
        self.assertEqual(shape(spec_of("apartment")), (True, ["wing_back", "back"]))
        self.assertEqual(shape(before())[0], False)
        self.assertEqual(shape(spec_of("mobile")), (True, ["back"]))

    def test_the_double_wide_is_long_and_low_on_skirting(self):
        doc = spec_of("mobile")
        self.assertGreater(doc["sides"]["front"]["length_in"], 2 * doc["sides"]["left"]["length_in"])
        self.assertTrue(doc["house"]["features"]["skirting"])
        self.assertEqual(doc["house"]["storeys"], 1)

    def test_the_apartment_is_one_larger_building_and_nothing_more(self):
        doc = spec_of("apartment")
        self.assertEqual(doc["house"]["storeys"], 2)
        self.assertFalse([s for s in doc["structures"] if s["kind"] in ("porch", "deck", "carport", "driveway")])
        area = {name: doc_area(spec_of(name)) for name in ("hero", "mobile", "apartment")}
        self.assertEqual(max(area, key=area.get), "apartment")

    def test_the_cli_passes_each_house_with_its_changes(self):
        for name in ("mobile", "apartment"):
            r, left, _ = check_args(spec_of(name), changes_of(name))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("HOUSE OK %s-before" % name, r.stdout)
            self.assertIn("after %s-after" % name, r.stdout)


def doc_area(doc):
    eds = house.edges(doc)
    return -sum(e["start"][0] * e["end"][1] - e["end"][0] * e["start"][1] for e in eds) / 2


class RefusedChanges(unittest.TestCase):
    def assertRefused(self, c, words):
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn(words, str(ctx.exception))
        r, left, inputs = check_args(before(), c)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn(words, r.stderr)
        self.assertNotIn("HOUSE OK", r.stdout)
        self.assertEqual((left, inputs), ([], ["changes.json", "doc.json"]))

    def test_an_after_scene_keeping_a_required_now_hazard(self):
        c = changes()
        entry(c, "wood-pile-wall")["change"] = "kept"
        for key in ("distance_in", "along_in"):
            entry(c, "wood-pile-wall").pop(key)
        self.assertRefused(c, "keeps required_now hazard wood-pile-wall")

    def test_an_after_scene_keeping_no_recommended_hazard(self):
        c = changes()
        entry(c, "fence-at-siding")["change"] = "removed"
        self.assertRefused(c, "keeps no recommended hazard")

    def test_naming_a_hazard_the_before_scene_does_not_have(self):
        c = changes()
        c["hazards"].append({"id": "ghost-1", "change": "removed"})
        self.assertRefused(c, "does not have ghost-1")

    def test_not_naming_every_before_hazard(self):
        c = changes()
        c["hazards"] = [e for e in c["hazards"] if e["id"] != "shed-right"]
        self.assertRefused(c, "every hazard once")

    def test_naming_a_hazard_twice(self):
        c = changes()
        c["hazards"].append({"id": "shed-right", "change": "removed"})
        self.assertRefused(c, "every hazard once")

    def test_changing_anything_but_hazards(self):
        c = changes()
        c["look"] = {"light": {"hdri": "polyhaven:goegap", "rotation_deg": 10}}
        self.assertRefused(c, "only hazards may change: look")

    def test_a_fixed_hazard_changing_more_than_placement_or_size(self):
        c = changes()
        entry(c, "shed-right")["side"] = "back"
        self.assertRefused(c, "placement or size")

    def test_a_removed_hazard_carrying_a_placement(self):
        c = changes()
        entry(c, "trash-cans-right")["distance_in"] = 500
        self.assertRefused(c, "only a fixed hazard")

    def test_a_fixed_hazard_moved_past_100_feet(self):
        c = changes()
        entry(c, "shed-right")["distance_in"] = 1300
        self.assertRefused(c, "past 100 feet")

    def test_changes_without_the_synthetic_flag(self):
        c = changes()
        del c["synthetic"]
        self.assertRefused(c, "synthetic")

    def test_changes_applied_to_an_after_spec(self):
        after = house.after_spec(before(), changes(), CATALOG, RULES)
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(after, changes(), CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("before house spec", str(ctx.exception))

    def test_changes_given_with_a_truth_file(self):
        r, left, _ = check_args(house.truth_from_spec(before()), changes())
        self.assertEqual((r.returncode, left), (3, []))
        self.assertIn("house spec", r.stderr)


class Rules(unittest.TestCase):
    def test_the_package_rules_have_concept_zone_and_statute(self):
        real = rule_for("wood_pile", "zone_0", None)
        self.assertEqual(RULES[real], {"concept": "wood_pile", "zone": "zone_0", "statute": None})
        self.assertIn("vhfhsz", {r["statute"] for r in RULES.values()})
        self.assertIn("sra", {r["statute"] for r in RULES.values()})

    def test_node_missing_is_refused_never_a_pass(self):
        with mock.patch.dict(os.environ, {"PATH": ""}):
            with self.assertRaises(house.HouseError) as ctx:
                house.load_rules()
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("rules package", str(ctx.exception))

    def test_node_missing_makes_the_cli_exit_3(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(tmp, "spec.json", before())
            r = subprocess.run([sys.executable, CHECK, path], capture_output=True, text=True, env={"PATH": tmp}, cwd=tmp)
            self.assertEqual(os.listdir(tmp), ["spec.json"])
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertNotIn("HOUSE OK", r.stdout)
        self.assertIn("rules package", r.stderr)

    def test_a_rules_package_that_prints_nothing_is_refused(self):
        class Empty:
            returncode, stdout, stderr = 0, "[]", ""

        with mock.patch.object(house.subprocess, "run", return_value=Empty()):
            with self.assertRaises(house.HouseError) as ctx:
                house.load_rules()
        self.assertIn("no rules", str(ctx.exception))

    def test_a_rules_package_that_fails_is_refused(self):
        class Failed:
            returncode, stdout, stderr = 1, "", "Cannot find package"

        with mock.patch.object(house.subprocess, "run", return_value=Failed()):
            with self.assertRaises(house.HouseError) as ctx:
                house.load_rules()
        self.assertIn("Cannot find package", str(ctx.exception))

    def test_a_rules_package_that_prints_junk_is_refused(self):
        class Junk:
            returncode, stdout, stderr = 0, "not json", ""

        with mock.patch.object(house.subprocess, "run", return_value=Junk()):
            with self.assertRaises(house.HouseError):
                house.load_rules()


class Cli(unittest.TestCase):
    def test_the_before_spec_exits_0_with_one_line(self):
        r = subprocess.run([sys.executable, CHECK, BEFORE], capture_output=True, text=True, cwd=support.REPO_DIR)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1)
        self.assertIn("HOUSE OK hero-before spec", r.stdout)
        self.assertIn("15 hazards", r.stdout)
        self.assertEqual(r.stderr, "")

    def test_the_changes_exit_0_with_one_line(self):
        r = subprocess.run([sys.executable, CHECK, BEFORE, "--changes", CHANGES], capture_output=True, text=True, cwd=support.REPO_DIR)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1)
        self.assertIn("after hero-after", r.stdout)
        self.assertIn("kept 1, fixed 5, removed 9", r.stdout)

    def test_a_truth_file_exits_0(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(tmp, "truth.json", house.truth_from_spec(before()))
            r = subprocess.run([sys.executable, CHECK, path], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("hero-before truth", r.stdout)

    def test_a_changes_file_with_an_unknown_key_is_invalid(self):
        c = changes()
        c["note"] = "x"
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(before(), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("unknown key note", str(ctx.exception))
        r, left, _ = check_args(before(), c)
        self.assertEqual((r.returncode, left), (3, []))

    def test_the_summary_counts_each_band_and_label(self):
        self.assertIn("15 hazards (0_5 9, 5_30 4, 30_100 2), required_now 12, recommended 3, clean side back", house.summary(before()))

    def test_the_check_module_does_not_run_when_imported(self):
        sys.path.insert(0, support.BLENDER_DIR)
        try:
            import check_house
        finally:
            sys.path.remove(support.BLENDER_DIR)
        self.assertEqual(check_house.check(BEFORE, None), house.summary(before()))


def tree(doc, tree_id):
    return next(t for t in doc["trees"] if t["id"] == tree_id)


def dist_to_ring(p, eds):
    out = []
    for e in eds:
        (ax, ay), (bx, by) = e["start"], e["end"]
        t = max(0.0, min(1.0, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / float((bx - ax) ** 2 + (by - ay) ** 2)))
        out.append(((p[0] - ax - t * (bx - ax)) ** 2 + (p[1] - ay - t * (by - ay)) ** 2) ** 0.5)
    return min(out)


class Siding(unittest.TestCase):
    assertRefused = Refused.assertRefused

    def test_every_house_has_one_siding_that_does_not_burn(self):
        for name in ("hero", "mobile", "apartment"):
            doc = spec_of(name)
            self.assertIn(doc["house"]["siding"], ("fiber cement lap", "stucco", "metal"), name)
            self.assertIn(doc["house"]["siding"], CATALOG[doc["look"]["siding"]["material"]]["sidings"], name)

    def test_the_apartment_is_stucco_and_the_two_others_fiber_cement_lap(self):
        walls = {name: (spec_of(name)["house"]["siding"], spec_of(name)["look"]["siding"]["material"]) for name in ("hero", "mobile", "apartment")}
        self.assertEqual(walls, {
            "hero": ("fiber cement lap", "polyhaven:weathered_plank_siding"),
            "mobile": ("fiber cement lap", "polyhaven:weathered_plank_siding"),
            "apartment": ("stucco", "polyhaven:white_stucco_02"),
        })
        self.assertEqual(CATALOG["polyhaven:white_stucco_02"]["sidings"], ["stucco"])
        self.assertEqual(CATALOG["polyhaven:white_stucco_02"]["license"], "CC0-1.0")
        house.validate(spec_of("apartment"), CATALOG, RULES)

    def test_a_lap_siding_on_the_stucco_texture_is_refused(self):
        doc = spec_of("apartment")
        doc["house"]["siding"] = "fiber cement lap"
        self.assertRefused(doc, "look.siding.material: polyhaven:white_stucco_02 is not a fiber cement lap siding texture")

    def test_wood_siding_is_refused(self):
        doc = before()
        doc["house"]["siding"] = "wood"
        self.assertRefused(doc, "house.siding: wood burns")

    def test_vinyl_siding_is_refused(self):
        doc = spec_of("mobile")
        doc["house"]["siding"] = "vinyl"
        self.assertRefused(doc, "house.siding: vinyl burns")

    def test_a_texture_that_is_not_that_siding_is_refused(self):
        doc = spec_of("hero")
        doc["house"]["siding"] = "stucco"
        self.assertRefused(doc, "look.siding.material: polyhaven:weathered_plank_siding is not a stucco siding texture")

    def test_a_siding_outside_the_list_is_invalid(self):
        doc = before()
        doc["house"]["siding"] = "straw"
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")


def struct(doc, struct_id):
    return next(s for s in doc["structures"] if s["id"] == struct_id)


def touches(a, b):
    a, b = a["min_in"] + a["max_in"], b["min_in"] + b["max_in"]
    side_by_side = (a[2] == b[0] or b[2] == a[0]) and min(a[3], b[3]) > max(a[1], b[1])
    end_to_end = (a[3] == b[1] or b[3] == a[1]) and min(a[2], b[2]) > max(a[0], b[0])
    return side_by_side or end_to_end


def door_span(doc, door):
    e = next(e for e in house.edges(doc) if e["side"] == door["side"])
    (sx, sy), (ex, ey) = e["start"], e["end"]
    ux, uy = (ex - sx) / e["length_in"], (ey - sy) / e["length_in"]
    a = (sx + ux * door["along_in"], sy + uy * door["along_in"])
    b = (a[0] + ux * door["width_in"], a[1] + uy * door["width_in"])
    return a, b


def under_door(s, span):
    (ax, ay), (bx, by) = span
    lo, hi = s["min_in"], s["max_in"]
    if ay == by:
        return lo[0] <= min(ax, bx) and max(ax, bx) <= hi[0] and ay in (lo[1], hi[1])
    return lo[1] <= min(ay, by) and max(ay, by) <= hi[1] and ax in (lo[0], hi[0])


class Structures(unittest.TestCase):
    assertRefused = Refused.assertRefused

    def test_every_structure_is_made_of_something_that_does_not_burn(self):
        for name in ("hero", "mobile", "apartment"):
            for s in spec_of(name)["structures"]:
                self.assertIn(s["material"], ("concrete", "asphalt", "gravel", "masonry", "metal"), (name, s["id"]))

    def test_a_wood_deck_is_refused(self):
        doc = before()
        struct(doc, "back-deck")["material"] = "wood"
        self.assertRefused(doc, "structures[2] back-deck: wood burns; a structure that burns is a hazard, not decoration")

    def test_a_composite_carport_is_refused(self):
        doc = spec_of("mobile")
        struct(doc, "carport")["material"] = "composite"
        self.assertRefused(doc, "carport: composite burns")

    def test_a_structure_with_no_material_is_invalid(self):
        doc = before()
        del struct(doc, "front-porch")["material"]
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")

    def test_a_raised_porch_with_no_steps_is_refused(self):
        doc = before()
        doc["structures"] = [s for s in doc["structures"] if s["id"] != "front-porch-steps"]
        self.assertRefused(doc, "front-porch: 12 in up with no steps")

    def test_a_porch_8_in_up_needs_no_steps(self):
        doc = before()
        doc["structures"] = [s for s in doc["structures"] if s["id"] != "front-porch-steps"]
        struct(doc, "front-porch")["height_in"] = 8
        house.validate(doc, CATALOG, RULES)

    def test_steps_that_lead_nowhere_are_refused(self):
        doc = before()
        struct(doc, "front-porch")["height_in"] = 8
        steps = struct(doc, "front-porch-steps")
        steps["min_in"], steps["max_in"] = [1500, -600], [1584, -552]
        self.assertRefused(doc, "front-porch-steps: the steps lead to no porch, deck, landing or balcony")

    def test_steps_at_the_end_of_a_porch_serve_it(self):
        doc = before()
        steps = struct(doc, "front-porch-steps")
        steps["min_in"], steps["max_in"] = [708, 216], [792, 288]
        house.validate(doc, CATALOG, RULES)

    def test_steps_that_touch_a_porch_only_at_its_corner_do_not_serve_it(self):
        doc = before()
        steps = struct(doc, "front-porch-steps")
        steps["min_in"], steps["max_in"] = [708, 180], [792, 204]
        self.assertRefused(doc, "front-porch: 12 in up with no steps")

    def test_every_raised_porch_deck_and_landing_has_steps(self):
        for name in ("hero", "mobile", "apartment"):
            doc = spec_of(name)
            for s in doc["structures"]:
                if s["kind"] in ("porch", "deck", "landing") and s["height_in"] > 8:
                    self.assertTrue([t for t in doc["structures"] if t["kind"] == "steps" and touches(s, t)], (name, s["id"]))

    def test_the_double_wide_has_a_side_carport_and_a_porch_with_steps_at_each_door(self):
        doc = house.validate(spec_of("mobile"), CATALOG, RULES)
        carport = struct(doc, "carport")
        self.assertEqual((carport["kind"], carport["material"]), ("carport", "metal"))
        self.assertTrue(carport["max_in"][0] <= 0 or carport["min_in"][0] >= doc["sides"]["front"]["length_in"])
        self.assertGreaterEqual(carport["max_in"][1] - carport["min_in"][1], 240)
        for door in (doc["front_door"], doc["back_door"]):
            porches = [s for s in doc["structures"] if s["kind"] == "porch" and under_door(s, door_span(doc, door))]
            self.assertEqual(len(porches), 1, door["side"])
            self.assertTrue([t for t in doc["structures"] if t["kind"] == "steps" and touches(porches[0], t)], door["side"])

    def test_the_hero_opens_onto_its_deck_by_a_back_door(self):
        doc = house.validate(before(), CATALOG, RULES)
        self.assertTrue(under_door(struct(doc, "back-deck"), door_span(doc, doc["back_door"])))

    def test_a_back_door_past_the_wall_end_is_invalid(self):
        doc = before()
        doc["back_door"]["along_in"] = 700
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("back_door: runs past the wall end", str(ctx.exception))

    def test_a_back_door_on_a_missing_side_is_refused(self):
        doc = before()
        doc["back_door"]["side"] = "porch_side"
        self.assertRefused(doc, "back_door: side porch_side is not in the house")

    def test_the_apartment_has_stairs_to_a_landing_and_balconies(self):
        doc = house.validate(spec_of("apartment"), CATALOG, RULES)
        kinds = sorted({s["kind"] for s in doc["structures"]})
        self.assertEqual(kinds, ["balcony", "landing", "road", "steps", "walkway"])
        landing = next(s for s in doc["structures"] if s["kind"] == "landing")
        self.assertGreaterEqual(landing["height_in"], 96)
        self.assertGreaterEqual(len([s for s in doc["structures"] if s["kind"] == "balcony"]), 2)


def windows(doc):
    return doc["house"]["features"]["windows"]


def window(side, along, width=36, height=40, sill=48):
    return {"side": side, "along_in": along, "width_in": width, "height_in": height, "sill_in": sill}


def wall_rect(item, low_key=None):
    low = item[low_key] if low_key else 0
    return item["along_in"], item["along_in"] + item["width_in"], low, low + item["height_in"]


class Openings(unittest.TestCase):
    assertRefused = Refused.assertRefused
    assertInvalid = Invalid.assertInvalid

    def test_the_hero_has_a_garage_door_on_the_garage_and_windows_on_four_sides(self):
        doc = house.validate(before(), CATALOG, RULES)
        self.assertEqual(doc["house"]["features"]["garage_door"]["side"], "garage")
        sides = [w["side"] for w in windows(doc)]
        self.assertIn(sides.count("front"), (2, 3))
        self.assertTrue({"right", "left", "back"} <= set(sides))

    def test_no_window_or_garage_door_lies_over_a_hazard_box(self):
        doc = before()
        openings = [(w["side"], wall_rect(w, "sill_in")) for w in windows(doc)]
        openings.append((doc["house"]["features"]["garage_door"]["side"], wall_rect(doc["house"]["features"]["garage_door"])))
        for h in doc["hazards"]:
            a0, a1, z0 = h["along_in"], h["along_in"] + h["size_in"][0], h["elevation_in"]
            for side, (b0, b1, w0, w1) in openings:
                if side == h["side"]:
                    self.assertFalse(a0 < b1 and b0 < a1 and z0 < w1 and w0 < z0 + h["size_in"][2], (h["id"], side, b0))

    def test_a_house_with_no_windows_and_no_garage_door_passes(self):
        doc = before()
        del doc["house"]["features"]["windows"], doc["house"]["features"]["garage_door"]
        house.validate(doc, CATALOG, RULES)

    def test_a_window_running_off_its_wall(self):
        doc = before()
        windows(doc).append(window("front", 330))
        self.assertInvalid(doc, "windows[%d]: runs past the wall end at 360 in" % (len(windows(doc)) - 1))

    def test_a_window_ending_at_its_wall_end_passes(self):
        doc = before()
        windows(doc).append(window("back", 684))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_on_a_side_the_house_does_not_have(self):
        doc = before()
        windows(doc).append(window("porch_side", 0))
        self.assertRefused(doc, "side porch_side is not in the house")

    def test_a_window_over_the_front_door(self):
        doc = before()
        windows(doc).append(window("front", 170, sill=90, height=12))
        self.assertRefused(doc, "overlaps front_door")

    def test_a_window_beside_the_front_door_passes(self):
        doc = before()
        windows(doc).append(window("front", 180, width=16, sill=36))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_ending_where_the_front_door_begins_passes(self):
        doc = before()
        windows(doc).append(window("front", 128, width=16, sill=36))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_stacked_below_another_passes(self):
        doc = before()
        first = windows(doc)[0]
        windows(doc).append(window(first["side"], first["along_in"], height=10, sill=first["sill_in"] - 10))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_overlapping_another_window(self):
        doc = before()
        first = windows(doc)[0]
        windows(doc).append(window(first["side"], first["along_in"] + first["width_in"] - 1, sill=first["sill_in"]))
        self.assertRefused(doc, "overlaps windows[0]")

    def test_a_window_stacked_above_another_passes(self):
        doc = before()
        first = windows(doc)[0]
        windows(doc).append(window(first["side"], first["along_in"], height=6, sill=first["sill_in"] + first["height_in"]))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_whose_top_passes_the_wall_height(self):
        doc = before()
        windows(doc).append(window("back", 680, sill=70, height=39))
        self.assertRefused(doc, "passes the wall height 108 in")

    def test_a_window_whose_top_meets_the_wall_height_passes(self):
        doc = before()
        windows(doc).append(window("back", 680, sill=70, height=38))
        house.validate(doc, CATALOG, RULES)

    def test_a_window_over_the_garage_door(self):
        doc = before()
        g = doc["house"]["features"]["garage_door"]
        windows(doc).append(window("garage", g["along_in"] + 10, sill=g["height_in"] - 1, height=10))
        self.assertRefused(doc, "overlaps garage_door")

    def test_a_garage_door_running_off_its_wall(self):
        doc = before()
        doc["house"]["features"]["garage_door"]["along_in"] = 200
        self.assertInvalid(doc, "garage_door: runs past the wall end at 360 in")

    def test_a_garage_door_over_the_back_door(self):
        doc = before()
        doc["house"]["features"]["garage_door"].update(side="back", along_in=320)
        self.assertRefused(doc, "garage_door: overlaps back_door")

    def test_a_garage_door_taller_than_its_wall(self):
        doc = before()
        doc["house"]["features"]["garage_door"]["height_in"] = 109
        self.assertRefused(doc, "garage_door: its top at 109 in passes the wall height 108 in")

    def test_a_garage_door_as_tall_as_its_wall_passes(self):
        doc = before()
        doc["house"]["features"]["garage_door"]["height_in"] = 108
        house.validate(doc, CATALOG, RULES)

    def test_a_garage_door_on_a_side_the_house_does_not_have(self):
        doc = before()
        doc["house"]["features"]["garage_door"]["side"] = "porch_side"
        self.assertRefused(doc, "garage_door: side porch_side is not in the house")

    def test_a_window_with_an_unknown_key(self):
        doc = before()
        windows(doc)[0]["tint"] = 1
        self.assertInvalid(doc, "unknown key tint")

    def test_a_window_with_no_sill(self):
        doc = before()
        del windows(doc)[0]["sill_in"]
        self.assertInvalid(doc, "sill_in")

    def test_a_garage_door_with_a_window_key(self):
        doc = before()
        doc["house"]["features"]["garage_door"]["sill_in"] = 0
        self.assertInvalid(doc, "unknown key sill_in")


class Trees(unittest.TestCase):
    def test_the_apartment_lot_is_treed_on_every_side(self):
        doc = house.validate(spec_of("apartment"), CATALOG, RULES)
        at = [t["at_in"] for t in doc["trees"]]
        self.assertGreaterEqual(len(at), 20)
        self.assertTrue([p for p in at if p[0] < 0] and [p for p in at if p[0] > 960])
        self.assertTrue([p for p in at if p[1] < 0] and [p for p in at if p[1] > 600])

    def test_every_branch_hazard_hangs_from_a_tree_and_every_named_branch_is_one(self):
        doc = spec_of("apartment")
        branches = sorted(h["id"] for h in doc["hazards"] if h["concept"] == "tree branch over roof")
        carried = sorted(b for t in doc["trees"] for b in t["branches"])
        self.assertEqual(branches, carried)
        self.assertEqual(sorted({haz(doc, b)["side"] for b in carried}), ["back", "front", "left"])
        for b in carried:
            self.assertEqual(haz(doc, b)["band"], "0_5")

    def test_every_trunk_stands_clear_of_the_walk_at_every_standoff(self):
        doc = spec_of("apartment")
        for standoff in range(120, 145):
            ring = house.loop(doc, standoff)
            for t in doc["trees"]:
                self.assertGreaterEqual(dist_to_ring(t["at_in"], ring) - t["trunk_in"] / 2.0, 24, (t["id"], standoff))

    def test_every_canopy_stays_5_feet_off_the_walls(self):
        doc = spec_of("apartment")
        for t in doc["trees"]:
            self.assertGreaterEqual(dist_to_ring(t["at_in"], house.edges(doc)) - t["canopy_in"] / 2.0, 60, t["id"])

    def test_the_after_scene_keeps_the_trees_and_cuts_the_branches(self):
        before_doc = spec_of("apartment")
        after = house.after_spec(house.validate(before_doc, CATALOG, RULES), changes_of("apartment"), CATALOG, RULES)
        self.assertEqual(after["trees"], before_doc["trees"])
        self.assertFalse([h for h in after["hazards"] if h["concept"] == "tree branch over roof"])

    def test_a_trunk_just_outside_the_walk_passes(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west").update(at_in=[700, 588], canopy_in=24)
        house.validate(doc, CATALOG, RULES)

    def test_a_trunk_between_the_wall_and_the_walk_passes(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west").update(at_in=[700, 492], canopy_in=24)
        house.validate(doc, CATALOG, RULES)

    def test_a_canopy_exactly_5_feet_off_the_wall_passes(self):
        doc = spec_of("apartment")
        tree(doc, "tree-right-near")["at_in"] = [1170, 160]
        house.validate(doc, CATALOG, RULES)

    def test_a_house_with_no_trees_passes(self):
        self.assertNotIn("trees", before())
        house.validate(before(), CATALOG, RULES)


class RefusedTrees(unittest.TestCase):
    assertRefused = Refused.assertRefused

    def test_a_trunk_in_the_walk(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west").update(at_in=[700, 587], canopy_in=24)
        self.assertRefused(doc, "tree-back-west: its trunk is in the walk")

    def test_a_trunk_on_the_loop_line(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west").update(at_in=[700, 540], canopy_in=24)
        self.assertRefused(doc, "tree-back-west: its trunk is in the walk")

    def test_a_canopy_inside_5_feet(self):
        doc = spec_of("apartment")
        tree(doc, "tree-right-near")["at_in"] = [1169, 160]
        self.assertRefused(doc, "tree-right-near: its canopy reaches 59 in from the house")

    def test_a_trunk_inside_the_house(self):
        doc = spec_of("apartment")
        tree(doc, "tree-right-near")["at_in"] = [500, 200]
        self.assertRefused(doc, "tree-right-near: its trunk runs into the house")

    def test_a_trunk_on_the_road(self):
        doc = spec_of("apartment")
        tree(doc, "tree-front-middle").update(at_in=[900, -1400], canopy_in=24)
        self.assertRefused(doc, "tree-front-middle: its trunk stands on road")

    def test_a_trunk_in_a_hazard(self):
        doc = spec_of("apartment")
        tree(doc, "tree-front-middle")["at_in"] = [600, -300]
        self.assertRefused(doc, "tree-front-middle: its trunk stands in dry-grass-front")

    def test_a_trunk_whose_west_half_stands_in_a_hazard(self):
        doc = spec_of("apartment")
        tree(doc, "tree-front-middle").update(at_in=[790, -300], canopy_in=24)
        self.assertRefused(doc, "tree-front-middle: its trunk stands in dry-grass-front")

    def test_a_trunk_whose_south_half_stands_in_a_hazard(self):
        doc = spec_of("apartment")
        tree(doc, "tree-front-middle").update(at_in=[600, -230], canopy_in=24)
        self.assertRefused(doc, "tree-front-middle: its trunk stands in dry-grass-front")

    def test_a_canopy_outside_the_lot(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["at_in"] = [100, 1900]
        self.assertRefused(doc, "tree-back-west: its canopy runs outside the lot")

    def test_a_tree_id_that_is_a_hazard_id(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["id"] = "shrub-front"
        self.assertRefused(doc, "shrub-front: id used twice")

    def test_a_tree_asset_that_is_not_a_tree(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["asset"] = "scripted:wood_pile"
        self.assertRefused(doc, "scripted:wood_pile is not a tree")

    def test_a_named_branch_that_is_not_a_hazard(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["branches"] = ["branch-over-garage"]
        self.assertRefused(doc, "tree-back-west: names branch branch-over-garage, which is not a hazard")

    def test_a_named_branch_of_another_concept(self):
        doc = spec_of("apartment")
        tree(doc, "tree-left-south")["branches"] = ["trash-cans-left"]
        self.assertRefused(doc, "trash-cans-left is not a tree branch over roof")

    def test_a_branch_that_does_not_reach_its_canopy(self):
        doc = spec_of("apartment")
        tree(doc, "tree-front-west")["branches"] = []
        tree(doc, "tree-left-south")["branches"] = ["branch-over-roof-front"]
        self.assertRefused(doc, "tree-left-south: branch branch-over-roof-front does not reach its canopy")

    def test_a_branch_named_by_two_trees(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["branches"] = ["branch-over-roof-back"]
        self.assertRefused(doc, "branch branch-over-roof-back is named twice")

    def test_changes_that_touch_the_trees(self):
        c = changes_of("apartment")
        c["trees"] = []
        with self.assertRaises(house.HouseError) as ctx:
            house.after_spec(house.validate(spec_of("apartment"), CATALOG, RULES), c, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("only hazards may change: trees", str(ctx.exception))

    def test_a_canopy_narrower_than_its_trunk_is_invalid(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["canopy_in"] = 20
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("narrower than its trunk", str(ctx.exception))

    def test_a_tree_with_an_unknown_key_is_invalid(self):
        doc = spec_of("apartment")
        tree(doc, "tree-back-west")["species"] = "oak"
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")


def block(doc, i):
    return doc["house"]["roof"]["blocks"][i]


class Roof(unittest.TestCase):
    def test_the_hero_roof_tiles_the_l_and_passes(self):
        doc = house.validate(before(), CATALOG, RULES)
        self.assertEqual([(b["min_in"], b["max_in"], b["ridge"]) for b in doc["house"]["roof"]["blocks"]],
                         [([0, 300], [720, 780], "east_west"), ([0, 0], [360, 300], "north_south")])

    def test_a_house_with_no_roof_block_still_passes_the_check(self):
        house.validate(spec_of("mobile"), CATALOG, RULES)

    def test_the_hero_prisms_overhang_free_sides_and_run_into_the_main_roof(self):
        main, garage = house.roof_prisms(before())
        self.assertEqual((main["lo"], main["hi"], main["ridge"]), ([-6, 294], [726, 786], "east_west"))
        self.assertEqual((main["wall_in"], main["eave_z_in"], main["ridge_z_in"]), (108, 106, 188))
        self.assertEqual((garage["lo"], garage["hi"], garage["ridge"]), ([-6, -6], [366, 480], "north_south"))
        self.assertEqual((garage["eave_z_in"], garage["ridge_z_in"]), (106, 168))

    def test_an_east_west_block_runs_into_its_neighbour_no_further_than_its_ridge(self):
        doc = before()
        doc["house"]["roof"]["blocks"] = [
            {"min_in": [0, 0], "max_in": [360, 780], "ridge": "north_south", "rise_in": 60},
            {"min_in": [360, 300], "max_in": [720, 780], "ridge": "east_west", "rise_in": 80},
        ]
        house.validate(doc, CATALOG, RULES)
        wing, arm = house.roof_prisms(doc)
        self.assertEqual((wing["lo"], wing["hi"]), ([-6, -6], [366, 786]))
        self.assertEqual((arm["lo"], arm["hi"]), ([180, 294], [726, 786]))

    def test_the_run_in_stops_where_the_main_slope_reaches_the_garage_ridge(self):
        main, garage = house.roof_prisms(before())
        y = garage["hi"][1]
        main_z = main["wall_in"] + (y - 300) * (main["ridge_z_in"] - main["wall_in"]) / 240.0
        self.assertEqual(main_z, garage["ridge_z_in"])

    def test_the_gutters_run_along_every_eave_edge_outside_the_house(self):
        runs = house.gutter_runs(before())
        self.assertIn(("north", [-6, 786], [726, 786]), [(g["facing"], g["start"], g["end"]) for g in runs])
        self.assertIn(("south", [366, 294], [726, 294]), [(g["facing"], g["start"], g["end"]) for g in runs])
        self.assertIn(("west", [-6, -6], [-6, 294]), [(g["facing"], g["start"], g["end"]) for g in runs])
        self.assertIn(("east", [366, -6], [366, 294]), [(g["facing"], g["start"], g["end"]) for g in runs])
        self.assertEqual(len(runs), 4)
        self.assertEqual({g["z_in"] for g in runs}, {106})

    def test_a_spec_with_no_roof_cannot_be_built(self):
        with self.assertRaises(house.HouseError) as ctx:
            house.roof_prisms(spec_of("mobile"))
        self.assertEqual(ctx.exception.kind, "refused")
        self.assertIn("house.roof is missing", str(ctx.exception))


class UsedAssets(unittest.TestCase):
    def test_the_hero_needs_its_look_its_hazards_and_their_materials_once_each(self):
        doc = before()
        ids = [u["id"] for u in house.used_assets(doc, CATALOG)]
        self.assertEqual(len(ids), len(set(ids)))
        look = doc["look"]
        self.assertEqual(ids[:4], [look["siding"]["material"], look["roof"]["material"], look["ground"]["material"], look["light"]["hdri"]])
        self.assertTrue({h["asset"] for h in doc["hazards"]} <= set(ids))
        self.assertIn("polyhaven:bark_brown_02", ids)
        self.assertIn("polyhaven:weathered_planks", ids)
        self.assertEqual({u["license"] for u in house.used_assets(doc, CATALOG)}, {CATALOG[i]["license"] for i in ids})

    def test_the_concrete_texture_is_listed_once_after_the_light(self):
        doc = before()
        ids = [u["id"] for u in house.used_assets(doc, CATALOG)]
        self.assertEqual(ids[4], "polyhaven:concrete_floor_02")
        self.assertEqual(ids.count("polyhaven:concrete_floor_02"), 1)
        del doc["look"]["concrete"]
        self.assertNotIn("polyhaven:concrete_floor_02", [u["id"] for u in house.used_assets(doc, CATALOG)])

    def test_trees_and_their_bark_are_listed(self):
        ids = [u["id"] for u in house.used_assets(spec_of("apartment"), CATALOG)]
        self.assertIn("scripted:lot_tree", ids)
        self.assertIn("polyhaven:white_stucco_02", ids)

    def test_fixed_hazards_of_an_after_spec_are_listed(self):
        doc = before()
        doc["fixed"] = [dict(haz(doc, "shed-right"), asset="scripted:propane_tank")]
        doc["hazards"] = []
        self.assertIn("scripted:propane_tank", [u["id"] for u in house.used_assets(doc, CATALOG)])


class RefusedRoof(unittest.TestCase):
    assertRefused = Refused.assertRefused

    def test_a_block_outside_the_walls(self):
        doc = before()
        block(doc, 1)["min_in"] = [0, -60]
        self.assertRefused(doc, "house.roof.blocks[1]: runs outside the walls")

    def test_two_blocks_that_overlap(self):
        doc = before()
        block(doc, 1)["max_in"] = [360, 360]
        self.assertRefused(doc, "house.roof.blocks[1]: overlaps blocks[0]")

    def test_blocks_that_leave_part_of_the_house_bare(self):
        doc = before()
        block(doc, 1)["max_in"] = [360, 240]
        self.assertRefused(doc, "house.roof: the blocks leave part of the house uncovered")

    def test_a_block_with_min_and_max_swapped(self):
        doc = before()
        block(doc, 1)["min_in"], block(doc, 1)["max_in"] = [360, 300], [0, 0]
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")
        self.assertIn("house.roof.blocks[1]: min_in must be south west of max_in", str(ctx.exception))

    def test_an_unknown_ridge(self):
        doc = before()
        block(doc, 0)["ridge"] = "diagonal"
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, CATALOG, RULES)
        self.assertEqual(ctx.exception.kind, "invalid")


def blender(args):
    return subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1"] + args, capture_output=True, text=True, timeout=1200)


SCRIPTED_SPECS = [BEFORE] + [os.path.join(support.REPO_DIR, "fixtures", "synthetic", name, "spec.json")
                             for name in ("mobile-before", "apartment-before", "test-yard-2")]
DETAIL = ["Corner trim", "back-deck", "front-porch-steps", "back-deck-steps", "probe-steps", "scripted:overhanging_branch", "scripted:storage_shed",
          "Garage door panels", "Garage door frame"] + ["Window %d frame" % k for k in range(1, len(windows(before())) + 1)]
WALKWAY_AT_THE_FOOT = [
    {"id": "probe-porch", "kind": "porch", "material": "concrete", "min_in": [0, 100], "max_in": [100, 200], "height_in": 24},
    {"id": "probe-steps", "kind": "steps", "material": "concrete", "min_in": [30, 60], "max_in": [70, 100], "height_in": 24},
    {"id": "probe-walkway", "kind": "walkway", "material": "concrete", "min_in": [30, 0], "max_in": [70, 60], "height_in": 0},
]
BOX_SLACK_IN = 2.0


def outside_corners(eds):
    corners = []
    for e in eds:
        cx, cy = e["start"]
        inside = sum(house._inside(eds, cx + dx, cy + dy) for dx in (-0.5, 0.5) for dy in (-0.5, 0.5))
        if inside == 1:
            corners.append((cx, cy))
    return corners


def in_wall(edge, part):
    """A dumped part's extent in its wall's frame: along the wall, out from its face, and up."""
    (sx, sy), (ux, uy), (nx, ny) = edge["start"], edge["u"], edge["n"]
    corners = [(x, y) for x in (part["min"][0], part["max"][0]) for y in (part["min"][1], part["max"][1])]
    along = [(x - sx) * ux + (y - sy) * uy for x, y in corners]
    out = [(x - sx) * nx + (y - sy) * ny for x, y in corners]
    return {"a": (min(along), max(along)), "o": (min(out), max(out)), "z": (part["min"][2], part["max"][2])}


RAY_OUT_IN = 24.0


def window_rays(doc):
    """A ray from 24 in outside each window, a quarter of the way along it and halfway up, straight in at the wall."""
    by_side = {e["side"]: e for e in house.edges(doc)}
    out = []
    for k, w in enumerate(windows(doc), 1):
        e = by_side[w["side"]]
        a, z = w["along_in"] + w["width_in"] / 4.0, w["sill_in"] + w["height_in"] / 2.0
        origin = [e["start"][i] + e["u"][i] * a + e["n"][i] * RAY_OUT_IN for i in (0, 1)] + [z]
        out.append({"name": "Window %d" % k, "origin_in": origin, "dir": [-e["n"][0], -e["n"][1], 0.0]})
    return out


def wall_rays(doc):
    """Rays straight in at the wall 8 in beyond each side of each window, wherever no other window sits."""
    by_side, wall = {e["side"]: e for e in house.edges(doc)}, house.roof_prisms(doc)[0]["wall_in"]
    rects = [(w["side"],) + wall_rect(w, "sill_in") for w in windows(doc)]
    out = []
    for w in windows(doc):
        e = by_side[w["side"]]
        a0, a1, z0, z1 = wall_rect(w, "sill_in")
        for a, z in ((a0 - 8, (z0 + z1) / 2.0), (a1 + 8, (z0 + z1) / 2.0), ((a0 + a1) / 2.0, z1 + 8), ((a0 + a1) / 2.0, z0 - 8)):
            near = [r for r in rects if r[0] == w["side"] and r[1] - 6 <= a <= r[2] + 6 and r[3] - 6 <= z <= r[4] + 6]
            if 1 < a < e["length_in"] - 1 and 1 < z < wall - 1 and not near:
                origin = [e["start"][i] + e["u"][i] * a + e["n"][i] * RAY_OUT_IN for i in (0, 1)] + [z]
                out.append({"name": "wall by %s" % w["side"], "origin_in": origin, "dir": [-e["n"][0], -e["n"][1], 0.0]})
    return out


def write_png(path, w, h, row):
    def chunk(tag, data):
        return pack(">I", len(data)) + tag + data + pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + row(y) for y in range(h))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b""))


def underside_at(verts, x, pick=min):
    low = {}
    for vx, _, vz in verts:
        key = round(vx, 2)
        low[key] = pick(low.get(key, vz), vz)
    xs = sorted(low)
    for a, b in zip(xs, xs[1:]):
        if a <= x <= b:
            return low[a] + (low[b] - low[a]) * (x - a) / (b - a)
    raise AssertionError("x %.2f is not under the roof %s" % (x, xs))


@unittest.skipUnless(BLENDER, "Blender not found: the house scene test did not run, so this is a PARTIAL RUN")
class HouseScene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        r = blender(["--python", BUILD_HOUSE, "--", BEFORE, "--out", cls.tmp.name])
        if r.returncode != 0:
            raise AssertionError("build failed: %s" % (r.stdout[-1500:] + r.stderr[-1500:]))
        cls.measured = os.path.join(cls.tmp.name, "measured.json")
        r = blender([os.path.join(cls.tmp.name, "scene.blend"), "--python", MEASURE, "--", "--out", cls.measured, "--every", "4000"])
        if r.returncode != 0:
            raise AssertionError("measure failed: %s" % r.stderr[-2000:])
        cls.record = support.load_json(cls.measured)
        cls.motion = support.load_json(os.path.join(cls.tmp.name, "motion.json"))
        dumped = os.path.join(cls.tmp.name, "dumped.json")
        argv = [os.path.join(cls.tmp.name, "scene.blend"), "--python", DUMP, "--", "--out", dumped,
                "--structures", write(cls.tmp.name, "structures.json", WALKWAY_AT_THE_FOOT), "--specs"] + SCRIPTED_SPECS
        for name in DETAIL:
            argv += ["--detail", name]
        argv += ["--verts", "Ground cover", "--paint", before()["look"]["siding"]["material"]]
        argv += ["--rays", write(cls.tmp.name, "rays.json", window_rays(before()) + wall_rays(before()))]
        r = blender(argv)
        if r.returncode != 0:
            raise AssertionError("dump failed: %s" % r.stderr[-2000:])
        cls.dumped = support.load_json(dumped)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def upstream(self, node, socket):
        links = self.dumped["world"]["links"]
        seen, todo = set(), [l["from"] for l in links if l["to"] == node and l["in"] == socket]
        while todo:
            n = todo.pop()
            if n not in seen:
                seen.add(n)
                todo += [l["from"] for l in links if l["to"] == n]
        types = {n["name"]: n["type"] for n in self.dumped["world"]["nodes"]}
        return {types[n] for n in seen}

    def test_the_camera_ray_never_reaches_the_hdri(self):
        links = self.dumped["world"]["links"]
        types = {n["name"]: n["type"] for n in self.dumped["world"]["nodes"]}
        surface = next(l for l in links if types[l["to"]] == "ShaderNodeOutputWorld" and l["in"] == "Surface")
        mix = surface["from"]
        self.assertEqual(types[mix], "ShaderNodeMixShader")
        fac = next(l for l in links if l["to"] == mix and l["in"] == "Fac")
        self.assertEqual((types[fac["from"]], fac["out"]), ("ShaderNodeLightPath", "Is Camera Ray"))
        textures = {"ShaderNodeTexEnvironment", "ShaderNodeTexImage"}
        self.assertFalse(self.upstream(mix, "Shader_001") & textures)
        self.assertIn("ShaderNodeTexEnvironment", self.upstream(mix, "Shader"))
        hdri = next(n for n in self.dumped["world"]["nodes"] if n["type"] == "ShaderNodeTexEnvironment")
        self.assertIn(before()["look"]["light"]["hdri"].split(":", 1)[1], os.path.basename(hdri["image"]))

    def test_the_camera_sky_grades_from_the_horizon_colour_up_to_the_zenith_colour(self):
        ramps = [n for n in self.dumped["world"]["nodes"] if n["type"] == "ShaderNodeValToRGB"]
        self.assertEqual(len(ramps), 1)
        sky = before()["look"]["light"]["sky"]
        low, high = sorted(ramps[0]["ramp"], key=lambda e: e["position"])
        self.assertEqual(low["position"], 0.0)
        self.assertAlmostEqual(high["position"], sky["zenith_at"], places=6)
        for element, hex_colour in ((low, sky["horizon"]), (high, sky["zenith"])):
            for got, want in zip(element["color"], linear(hex_colour) + [1.0]):
                self.assertAlmostEqual(got, want, places=4, msg=hex_colour)

    def test_final_settings_are_cycles_with_adaptive_sampling_and_denoise(self):
        f = self.dumped["final"]
        self.assertEqual((f["engine"], f["adaptive"], f["denoiser"], f["persistent_data"]), ("CYCLES", True, "OPENIMAGEDENOISE", True))
        self.assertEqual((f["samples"], round(f["adaptive_threshold"], 6)), (engine.FINAL["samples"], engine.FINAL["adaptive_threshold"]))
        self.assertEqual(f["device"], "GPU" if f["gpus"] else "CPU")
        if sys.platform == "darwin" and os.uname().machine == "arm64":
            self.assertEqual(f["device"], "GPU", "an Apple silicon Mac lists its Metal GPU")

    def test_test_renders_stay_eevee(self):
        self.assertTrue(self.dumped["scene"]["engine"].startswith("BLENDER_EEVEE"))

    def test_the_eevee_engine_id_matches_the_running_blender(self):
        sc = self.dumped["scene"]
        self.assertEqual(sc["engine"], engine.eevee_id(sc["version"]))
        self.assertIn(sc["engine"], sc["engines"])

    def test_the_scene_has_no_text_object_and_no_render_stamp(self):
        self.assertNotIn("FONT", self.dumped["scene"]["types"])
        self.assertFalse(self.dumped["scene"]["use_stamp"])

    def test_the_house_builds_no_number_or_sign(self):
        self.assertNotIn("FONT", self.dumped["scene"]["types"])
        cache = os.path.realpath(assets.cache_dir())
        for path in self.dumped["scene"]["images"]:
            self.assertTrue(os.path.realpath(path).startswith(cache + os.sep), path)

    def test_check14_a_painted_material_from_a_fresh_material_has_its_nodes(self):
        p = self.dumped["painted"]
        self.assertTrue(p["use_nodes"])
        self.assertIn("ShaderNodeBsdfPrincipled", p["nodes"])
        self.assertIn("ShaderNodeTexImage", p["nodes"])

    def test_check14_node_owner_turns_nodes_on_for_an_owner_that_has_them_off(self):
        self.assertIs(self.dumped["node_owner"], True)

    def render_frames(self, folder, *extra):
        return blender([os.path.join(self.tmp.name, "scene.blend"), "--python", RENDER_FRAMES, "--", "--spec", BEFORE,
                        "--motion", os.path.join(self.tmp.name, "motion.json"), "--frames", folder] + list(extra))

    def test_a_render_chunk_resumes_and_skips_frames_already_written_in_blender(self):
        folder = os.path.join(self.tmp.name, "frames")
        r = self.render_frames(folder, "--test", "--percent", "10", "--chunk", "2", "--only", "1:2")
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertEqual(sorted(f for f in os.listdir(folder) if f.endswith(".png")), [chunks.frame_name(1), chunks.frame_name(2)])
        plan = support.load_json(os.path.join(folder, "chunks.json"))
        self.assertEqual(plan["chunks"], chunks.plan(self.motion["frame_count"], chunks.hazard_frames(before(), self.motion), 2))
        os.remove(os.path.join(folder, chunks.frame_name(2)))
        r = self.render_frames(folder, "--test", "--percent", "10", "--chunk", "2", "--only", "1:2")
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertEqual([l.split()[1] for l in r.stdout.splitlines() if l.startswith("EW_FRAME ")], ["2"])

    def test_a_final_render_refuses_a_cut_resolution(self):
        r = self.render_frames(os.path.join(self.tmp.name, "refused"), "--percent", "50", "--only", "1:1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--percent is for test renders only", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "refused")))

    def test_every_hazard_fills_its_spec_box(self):
        boxes = route.hazard_boxes(before())
        self.assertEqual(sorted(self.record["hazards"]), sorted(boxes))
        for hid, box in boxes.items():
            got = self.record["hazards"][hid]["min"] + self.record["hazards"][hid]["max"]
            want = list(box[:3]) + list(box[3:])
            for g, w in zip(got, want):
                self.assertAlmostEqual(g, w, delta=0.5, msg=hid)

    def test_the_house_parts_are_built(self):
        objects = set(self.record["objects"])
        for name in ("House wall", "Roof 1", "Roof 2", "Chimney", "Front door", "Back door", "Ground", "front-porch", "back-deck-steps", "driveway", "road"):
            self.assertIn("MESH:" + name, objects)
        self.assertEqual(len([o for o in objects if o.startswith("MESH:Gutter ")]), len(house.gutter_runs(before())))
        self.assertEqual(len([o for o in objects if o.startswith("MESH:Vent ")]), 2)

    def test_the_render_follows_the_route(self):
        render, m = self.record["render"], self.motion
        self.assertEqual((render["width_px"], render["height_px"], render["fps"], render["frame_count"]),
                         (m["camera"]["width_px"], m["camera"]["height_px"], m["fps"], m["frame_count"]))
        self.assertEqual((render["focal_mm"], render["label"]), (m["camera"]["focal_mm"], "Synthetic sample house"))

    def test_the_camera_starts_at_the_first_route_sample(self):
        first_pose = self.record["camera"][0]
        self.assertEqual(first_pose["frame"], 1)
        for g, w in zip(first_pose["pos_in"], self.motion["samples"][0]["pos_in"]):
            self.assertAlmostEqual(g, w, delta=0.05)

    def test_the_parts_file_covers_the_walk(self):
        parts = support.load_json(os.path.join(self.tmp.name, "parts.json"))
        self.assertEqual(parts["parts"][0]["start_frame"], 1)
        self.assertEqual(parts["parts"][-1]["end_frame"], self.motion["frame_count"])

    def test_the_blend_is_saved_compressed(self):
        with open(os.path.join(self.tmp.name, "scene.blend"), "rb") as f:
            head = f.read(7)
        self.assertNotEqual(head, b"BLENDER")
        self.assertEqual(head[:4], b"\x28\xb5\x2f\xfd")

    def test_the_scene_record_names_the_synthetic_hero_before_scene(self):
        rec = support.load_json(os.path.join(self.tmp.name, "scene.json"))
        self.assertIs(rec["synthetic"], True)
        self.assertEqual((rec["schema"], rec["label"], rec["scene"]), ("emberwalk.scene/1", "Synthetic sample house", "hero-before"))

    def test_the_build_time_is_a_real_duration(self):
        seconds = support.load_json(os.path.join(self.tmp.name, "scene.json"))["build_seconds"]
        self.assertGreater(seconds, 0)
        self.assertLess(seconds, 600)

    def test_each_roof_covers_its_prism_from_eave_to_ridge(self):
        prisms = house.roof_prisms(before())
        for k, p in enumerate(prisms, 1):
            got = self.dumped["objects"]["Roof %d" % k]
            for i in (0, 1):
                self.assertAlmostEqual(got["min"][i], p["lo"][i], delta=0.5, msg="Roof %d" % k)
                self.assertAlmostEqual(got["max"][i], p["hi"][i], delta=0.5, msg="Roof %d" % k)
            self.assertAlmostEqual(got["max"][2], p["ridge_z_in"], delta=0.5, msg="Roof %d" % k)
            self.assertLess(got["min"][2], p["eave_z_in"], "Roof %d" % k)
            self.assertGreaterEqual(got["min"][2], p["eave_z_in"] - 12, "Roof %d" % k)

    def test_the_chimney_cap_overhangs_the_chimney_on_all_four_sides(self):
        cap, stack = self.dumped["objects"]["Chimney cap"], self.dumped["objects"]["Chimney"]
        for i in (0, 1):
            self.assertLess(cap["min"][i], stack["min"][i])
            self.assertGreater(cap["max"][i], stack["max"][i])
        self.assertAlmostEqual(cap["min"][2], stack["max"][2], delta=0.5)

    def test_the_deck_stands_on_square_posts_under_its_slab(self):
        deck = next(s for s in before()["structures"] if s["id"] == "back-deck")
        slab_z = deck["height_in"] - 2
        posts = [i for i in self.dumped["objects"]["back-deck"]["islands"] if i["max"][2] <= slab_z + 0.01]
        self.assertTrue(posts)
        for p in posts:
            for ax in (0, 1):
                self.assertAlmostEqual(p["max"][ax] - p["min"][ax], 4, delta=0.01)
                self.assertGreaterEqual(p["min"][ax], deck["min_in"][ax] - 0.01)
                self.assertLessEqual(p["max"][ax], deck["max_in"][ax] + 0.01)
            self.assertAlmostEqual(p["min"][2], 0, delta=0.01)
            self.assertAlmostEqual(p["max"][2], slab_z, delta=0.01)

    def test_corner_trim_stands_proud_at_every_outside_corner_and_nowhere_else(self):
        eds = house.edges(before())
        corners = outside_corners(eds)
        pieces = self.dumped["objects"]["Corner trim"]["islands"]
        self.assertEqual(len(corners), 5)
        self.assertEqual(len(pieces), len(corners))
        wall = house.roof_prisms(before())[0]["wall_in"]
        for i, e in enumerate(eds):
            if e["start"] not in corners:
                continue
            cx, cy = e["start"]
            holding = [p for p in pieces if p["min"][0] < cx < p["max"][0] and p["min"][1] < cy < p["max"][1]]
            self.assertEqual(len(holding), 1, (cx, cy))
            piece = holding[0]
            for n in (eds[i - 1]["n"], e["n"]):
                reach = max(n[0] * (piece[k][0] - cx) + n[1] * (piece[k][1] - cy) for k in ("min", "max"))
                self.assertGreater(reach, 0, (cx, cy, n))
            self.assertAlmostEqual(piece["min"][2], 0, delta=0.01)
            self.assertAlmostEqual(piece["max"][2], wall, delta=0.01)

    def test_every_scripted_builder_stays_in_its_box(self):
        built = self.dumped["scripted"]
        self.assertEqual(sorted({s["asset"] for s in built}), self.dumped["builders"])
        for s in built:
            for key, part in s["parts"].items():
                if part["min"] is None:
                    continue
                for i in range(3):
                    where = "%s %s %s axis %d" % (s["asset"], s["id"], key, i)
                    self.assertGreaterEqual(part["min"][i], -BOX_SLACK_IN, where)
                    self.assertLessEqual(part["max"][i], s["size_in"][i] + BOX_SLACK_IN, where)

    def test_the_shed_roof_meets_its_walls(self):
        sheds = [s for s in self.dumped["scripted"] if s["asset"] == "scripted:storage_shed"]
        self.assertTrue(sheds)
        for s in sheds:
            walls = max(s["parts"]["main"]["islands"], key=lambda i: len(i["verts"]))
            roof = [v for i in s["parts"]["Shed roof"]["islands"] for v in i["verts"]]
            for x in (walls["min"][0], walls["max"][0]):
                self.assertLessEqual(underside_at(roof, x), walls["max"][2] + 0.01, "%s at x %.1f" % (s["id"], x))
                self.assertAlmostEqual(underside_at(roof, x, max), walls["max"][2], delta=0.05, msg="%s roof top at x %.1f" % (s["id"], x))

    def test_the_leaf_clumps_along_the_limb_sit_on_top_of_it(self):
        branches = [s for s in self.dumped["scripted"] if s["asset"] == "scripted:overhanging_branch"]
        self.assertTrue(branches)
        for s in branches:
            joints = []
            for piece in s["parts"]["main"]["islands"]:
                if max(c["radius_in"] for c in piece["caps"]) > 1.2:
                    joints += [c["centre"] for c in piece["caps"] if all(math.dist(c["centre"], j) > 0.2 for j in joints)]
            self.assertEqual(len(joints), 5, s["id"])
            leaves = s["parts"]["Dry leaves"]["face_centres"]
            for j in sorted(joints, key=lambda j: j[1])[:-1]:
                near = [lf for lf in leaves if math.hypot(lf[0] - j[0], lf[1] - j[1]) < 6]
                above = [lf for lf in near if lf[2] > j[2]]
                self.assertGreaterEqual(len(near), 10, (s["id"], j))
                self.assertGreaterEqual(len(above), 0.75 * len(near), (s["id"], j))

    def assertRings(self, e, dumped, inner, bottom):
        frame, pieces = in_wall(e, dumped), [in_wall(e, p) for p in dumped["islands"]]
        spans = [p for p in pieces if abs(p["a"][0] - inner["a"][0]) < 0.01 and abs(p["a"][1] - inner["a"][1]) < 0.01]
        self.assertEqual(len([p for p in spans if p["z"][0] >= inner["z"][1] - 0.01]), 1, "one head above")
        self.assertEqual(len([p for p in spans if p["z"][1] <= inner["z"][0] + 0.01]), 1 if bottom else 0, "sill below")
        self.assertEqual(len([p for p in pieces if p["a"][1] <= inner["a"][0] + 0.01]), 1, "one jamb before")
        self.assertEqual(len([p for p in pieces if p["a"][0] >= inner["a"][1] - 0.01]), 1, "one jamb after")
        for k in (0, 1):
            margin = abs(frame["a"][k] - inner["a"][k])
            self.assertTrue(2 <= margin <= 4, ("along", k, margin))
        self.assertTrue(2 <= frame["z"][1] - inner["z"][1] <= 4, ("top", frame["z"], inner["z"]))
        if bottom:
            self.assertTrue(2 <= inner["z"][0] - frame["z"][0] <= 4, ("bottom", frame["z"], inner["z"]))
        else:
            self.assertAlmostEqual(frame["z"][0], 0, delta=0.01)
        self.assertGreaterEqual(frame["o"][0], -0.01)
        self.assertGreater(frame["o"][1], inner["o"][1] + 0.25)

    def assertAtSpec(self, got, item, low, out=(0, 0.6)):
        want = {"a": (item["along_in"], item["along_in"] + item["width_in"]), "z": (low, low + item["height_in"])}
        for key in ("a", "z"):
            for k in (0, 1):
                self.assertAlmostEqual(got[key][k], want[key][k], delta=0.5, msg=(key, k, item))
        self.assertGreaterEqual(got["o"][0], out[0] - 0.01, item)
        self.assertTrue(out[0] < got["o"][1] <= out[1], (got["o"], item))

    def test_each_window_glass_lies_set_back_in_its_wall_at_the_spec_place(self):
        by_side = {e["side"]: e for e in house.edges(before())}
        objects = self.dumped["objects"]
        for k, w in enumerate(windows(before()), 1):
            self.assertAtSpec(in_wall(by_side[w["side"]], objects["Window %d glass" % k]), w, w["sill_in"], (-3.0, -1.0))
        self.assertNotIn("Window %d glass" % (len(windows(before())) + 1), objects)

    def test_the_driveway_and_porch_wear_the_concrete_texture(self):
        objects, materials = self.dumped["objects"], self.dumped["materials"]
        for name in ("driveway", "front-porch", "front-porch-steps"):
            self.assertEqual(len(objects[name]["materials"]), 1, name)
            images = materials[objects[name]["materials"][0]]["images"]
            self.assertTrue(images and all("concrete_floor_02" in i for i in images), (name, images))
        self.assertFalse(materials[objects["road"]["materials"][0]]["images"])

    def test_window_glass_is_clear_glass_that_lets_the_light_in(self):
        materials = self.dumped["materials"]
        for k in range(1, len(windows(before())) + 1):
            glass = self.dumped["objects"]["Window %d glass" % k]
            self.assertFalse(glass["shadow"], k)
            p = materials[glass["materials"][0]]["inputs"]
            self.assertGreaterEqual(p["Transmission Weight"], 0.95, k)
            self.assertTrue(1.45 <= p["IOR"] <= 1.55, p)
            self.assertLessEqual(p["Roughness"], 0.05, k)

    def test_a_ray_into_each_window_meets_the_set_back_glass_then_the_room_behind_it(self):
        rays = window_rays(before())
        self.assertEqual(len(self.dumped["rays"]), len(rays) + len(wall_rays(before())))
        for ray, hits in zip(rays, self.dumped["rays"]):
            names = [h["object"] for h in hits]
            self.assertEqual(names[:2], [ray["name"] + " glass", ray["name"] + " room"], names)
            self.assertTrue(RAY_OUT_IN + 1.0 <= hits[0]["distance_in"] <= RAY_OUT_IN + 3.0, hits)
            self.assertGreaterEqual(hits[1]["distance_in"] - hits[0]["distance_in"], 12, hits)

    def test_the_wall_around_each_window_is_whole(self):
        rays, hits = wall_rays(before()), self.dumped["rays"][len(window_rays(before())):]
        self.assertGreaterEqual(len(rays), 2 * len(windows(before())))
        for ray, h in zip(rays, hits):
            first = [x for x in h if x["object"] == "House wall" or x["object"].startswith("Window ")]
            self.assertTrue(first, (ray, h))
            self.assertEqual(first[0]["object"], "House wall", (ray, h))
            self.assertAlmostEqual(first[0]["distance_in"], RAY_OUT_IN, delta=0.01, msg=ray)

    def test_each_window_room_stays_inside_the_house_and_is_not_black(self):
        doc = before()
        eds = house.edges(doc)
        by_side = {e["side"]: e for e in eds}
        for k, w in enumerate(windows(doc), 1):
            e, room = by_side[w["side"]], self.dumped["objects"]["Window %d room" % k]
            r = in_wall(e, room)
            self.assertAlmostEqual(r["o"][1], 0, delta=0.01, msg=k)
            for a in (r["a"][0] + 0.5, r["a"][1] - 0.5):
                x = e["start"][0] + e["u"][0] * a + e["n"][0] * (r["o"][0] + 0.5)
                y = e["start"][1] + e["u"][1] * a + e["n"][1] * (r["o"][0] + 0.5)
                self.assertTrue(house._inside(eds, x, y), (k, a))
            paint = self.dumped["materials"][room["materials"][0]]["inputs"]
            self.assertGreaterEqual(sum(w8 * c for w8, c in zip(stills.WEIGHTS, paint["Base Color"])), 0.3, k)
            self.assertEqual(paint["Metallic"], 0.0, k)

    def test_the_camera_sky_carries_procedural_cloud_that_the_light_never_sees(self):
        links = self.dumped["world"]["links"]
        types = {n["name"]: n["type"] for n in self.dumped["world"]["nodes"]}
        mix = next(l for l in links if types[l["to"]] == "ShaderNodeOutputWorld" and l["in"] == "Surface")["from"]
        self.assertIn("ShaderNodeTexNoise", self.upstream(mix, "Shader_001"))
        self.assertNotIn("ShaderNodeTexNoise", self.upstream(mix, "Shader"))
        noise = [n for n in self.dumped["world"]["nodes"] if n["type"] == "ShaderNodeTexNoise"]
        self.assertEqual([n["scale"] for n in noise], [before()["look"]["light"]["sky"]["clouds"]["scale"]])

    def check_stills(self, folder, frames):
        argv = [os.path.join(self.tmp.name, "scene.blend"), "--python", CHECK_STILLS, "--", "--spec", BEFORE, "--frames", folder, "--step", "16"]
        for f in frames:
            argv += ["--frame", str(f)]
        return blender(argv)

    def test_the_still_check_refuses_flat_white_and_black_stills(self):
        with tempfile.TemporaryDirectory() as tmp:
            for f in (1501, 1560):
                write_png(os.path.join(tmp, chunks.frame_name(f)), 1920, 1080, lambda y: b"\xf0" * 5760)
            r = self.check_stills(tmp, [1501, 1560])
            self.assertEqual(r.returncode, 3, r.stderr[-1500:])
            for words in ("driveway is near white", "driveway is flat, no texture", "sky is near white", "sky is flat"):
                self.assertIn(words, r.stdout)
            self.assertNotIn("glass is near pure black", r.stdout)
            write_png(os.path.join(tmp, chunks.frame_name(1560)), 1920, 1080, lambda y: b"\x03" * 5760)
            r = self.check_stills(tmp, [1560])
            self.assertEqual(r.returncode, 3, r.stderr[-1500:])
            self.assertIn("glass is near pure black", r.stdout)

    def test_the_still_check_passes_stills_with_detail_and_finds_each_region(self):
        rng = random.Random(7)
        with tempfile.TemporaryDirectory() as tmp:
            for f in (1501, 1560):
                write_png(os.path.join(tmp, chunks.frame_name(f)), 1920, 1080, lambda y: bytes(40 + b // 2 for b in rng.randbytes(5760)))
            r = self.check_stills(tmp, [1501, 1560])
            self.assertEqual(r.returncode, 0, r.stdout[-1500:] + r.stderr[-1500:])
            found = [json.loads(line.split(" ", 1)[1]) for line in r.stdout.splitlines() if line.startswith("EW_STILL ")]
            self.assertEqual([f["frame"] for f in found], [1501, 1560])
            self.assertEqual(sorted(found[0]["regions"]), ["driveway", "sky"])
            self.assertEqual(sorted(found[1]["regions"]), ["driveway", "glass", "sky"])
            for f in found:
                self.assertTrue(all(st["pixels"] >= 40 for st in f["regions"].values()), f)

    def test_the_still_check_reads_every_16th_pixel_from_the_bottom_left_corner(self):
        rng = random.Random(3)

        def row(y):
            if (1079 - y) % 16:
                return b"\xf0" * 5760
            return b"".join(bytes(40 + b // 2 for b in rng.randbytes(3)) if x % 16 == 0 else b"\xf0\xf0\xf0" for x in range(1920))
        with tempfile.TemporaryDirectory() as tmp:
            write_png(os.path.join(tmp, chunks.frame_name(1501)), 1920, 1080, row)
            r = self.check_stills(tmp, [1501])
            self.assertEqual(r.returncode, 0, r.stdout[-1500:] + r.stderr[-1500:])

    def test_the_still_check_refuses_a_missing_or_wrong_size_still(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.check_stills(tmp, [1501])
            self.assertEqual(r.returncode, 2)
            self.assertIn("no still", r.stderr)
            write_png(os.path.join(tmp, chunks.frame_name(1501)), 192, 108, lambda y: b"\x80" * 576)
            r = self.check_stills(tmp, [1501])
            self.assertEqual(r.returncode, 2)
            self.assertIn("the scene renders 1920 by 1080", r.stderr)
            scene = os.path.join(self.tmp.name, "scene.blend")
            for drop in ("--spec", "--frames"):
                args = {"--spec": BEFORE, "--frames": tmp}
                del args[drop]
                r = blender([scene, "--python", CHECK_STILLS, "--"] + [x for kv in args.items() for x in kv] + ["--frame", "1501"])
                self.assertNotEqual(r.returncode, 0, drop)
                self.assertIn("the following arguments are required: %s" % drop, r.stderr)

    def test_each_window_frame_rings_its_glass_with_one_bar_down_its_middle(self):
        by_side = {e["side"]: e for e in house.edges(before())}
        for k, w in enumerate(windows(before()), 1):
            e = by_side[w["side"]]
            glass = in_wall(e, self.dumped["objects"]["Window %d glass" % k])
            frame = self.dumped["objects"]["Window %d frame" % k]
            self.assertRings(e, frame, glass, True)
            pieces = [in_wall(e, p) for p in frame["islands"]]
            self.assertEqual(len(pieces), 5, k)
            inside = [p for p in pieces if glass["a"][0] < p["a"][0] and p["a"][1] < glass["a"][1]]
            self.assertEqual(len(inside), 1, k)
            bar = inside[0]
            self.assertAlmostEqual(sum(bar["a"]) / 2.0, sum(glass["a"]) / 2.0, delta=0.5, msg=k)
            self.assertAlmostEqual(bar["z"][0], glass["z"][0], delta=0.01, msg=k)
            self.assertAlmostEqual(bar["z"][1], glass["z"][1], delta=0.01, msg=k)
            self.assertTrue(glass["o"][1] < bar["o"][1] < in_wall(e, frame)["o"][1], k)

    def test_the_garage_door_fills_its_spec_place_in_four_rows_of_panels_inside_a_frame(self):
        doc = before()
        g = doc["house"]["features"]["garage_door"]
        e = next(e for e in house.edges(doc) if e["side"] == g["side"])
        objects = self.dumped["objects"]
        slab = in_wall(e, objects["Garage door"])
        self.assertAtSpec(slab, g, 0)
        self.assertRings(e, objects["Garage door frame"], slab, False)
        self.assertEqual(len(objects["Garage door frame"]["islands"]), 3)
        panels = [in_wall(e, p) for p in objects["Garage door panels"]["islands"]]
        rows = sorted({round(p["z"][0], 2) for p in panels})
        self.assertEqual(len(rows), 4)
        self.assertEqual(len(panels) % 4, 0)
        self.assertGreaterEqual(len(panels), 8)
        for p in panels:
            self.assertTrue(slab["a"][0] + 1 < p["a"][0] and p["a"][1] < slab["a"][1] - 1, p)
            self.assertTrue(slab["z"][0] + 1 < p["z"][0] and p["z"][1] < slab["z"][1] - 1, p)
            self.assertGreater(p["o"][1], slab["o"][1])
            self.assertGreaterEqual(p["o"][0], -0.01)
            self.assertTrue(12 <= p["a"][1] - p["a"][0] <= 30, p)
        for lo, hi in zip(rows, rows[1:]):
            below = [p for p in panels if round(p["z"][0], 2) == lo]
            self.assertTrue(all(p["z"][1] < hi for p in below), (lo, hi))
        columns = sorted(p["a"] for p in panels if round(p["z"][0], 2) == rows[0])
        for (a0, a1), (b0, b1) in zip(columns, columns[1:]):
            self.assertLess(a1, b0)

    def test_the_ground_cover_is_the_tufts_blade_for_blade(self):
        got = self.dumped["objects"]["Ground cover"]["verts"]
        want = tuft_verts(route.ground_cover(before()))
        self.assertEqual(len(got), len(want))
        for g, w in zip(got, want):
            for i in range(3):
                self.assertAlmostEqual(g[i], w[i], delta=0.01)

    def test_steps_fall_away_from_the_porch_or_deck_they_lead_to(self):
        cases = [(before()["structures"], "front-porch-steps", "front-porch"), (before()["structures"], "back-deck-steps", "back-deck"),
                 (WALKWAY_AT_THE_FOOT, "probe-steps", "probe-porch")]
        for structures, steps_id, to_id in cases:
            s, t = [next(x for x in structures if x["id"] == i) for i in (steps_id, to_id)]
            axis = next(ax for ax in (0, 1) if s["max_in"][ax] == t["min_in"][ax] or s["min_in"][ax] == t["max_in"][ax])
            face = s["max_in"][axis] if s["max_in"][axis] == t["min_in"][axis] else s["min_in"][axis]
            treads = self.dumped["objects"][steps_id]["islands"]
            by_distance = sorted(treads, key=lambda p: abs((p["min"][axis] + p["max"][axis]) / 2.0 - face))
            tops = [p["max"][2] for p in by_distance]
            self.assertEqual(tops, sorted(tops, reverse=True), steps_id)
            self.assertEqual(len(set(tops)), len(tops), steps_id)
            highest = max(treads, key=lambda p: p["max"][2])
            self.assertTrue(min(abs(highest["min"][axis] - face), abs(highest["max"][axis] - face)) < 0.01, steps_id)
            self.assertLess(highest["max"][2], s["height_in"], steps_id)


@unittest.skipUnless(BLENDER, "Blender not found: the house build refusals did not run, so this is a PARTIAL RUN")
class HouseSceneRefused(unittest.TestCase):
    def assertRefusedBuild(self, doc, words):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            r = blender(["--python", BUILD_HOUSE, "--", write(tmp, "doc.json", doc), "--out", out])
            self.assertEqual(r.returncode, 3, r.stdout[-800:] + r.stderr[-800:])
            self.assertIn(words, r.stderr)
            self.assertFalse(os.path.exists(out))

    def test_a_house_with_no_roof(self):
        self.assertRefusedBuild(spec_of("mobile"), "house.roof is missing")

    def test_a_spec_the_check_refuses(self):
        doc = before()
        doc["synthetic"] = False
        self.assertRefusedBuild(doc, "synthetic must be true")

    def test_a_house_with_trees(self):
        self.assertRefusedBuild(spec_of("apartment"), "trees are not built yet")


class Engines(unittest.TestCase):
    def test_the_eevee_engine_id_follows_the_blender_version(self):
        self.assertEqual(engine.eevee_id((4, 5, 15)), "BLENDER_EEVEE_NEXT")
        self.assertEqual(engine.eevee_id((4, 2, 0)), "BLENDER_EEVEE_NEXT")
        self.assertEqual(engine.eevee_id((4, 1, 1)), "BLENDER_EEVEE")
        self.assertEqual(engine.eevee_id((5, 0, 0)), "BLENDER_EEVEE")
        self.assertEqual(engine.eevee_id((5, 2, 2)), "BLENDER_EEVEE")

    def test_cycles_takes_the_metal_gpu_when_one_is_listed(self):
        listed = [{"name": "Apple M4 (GPU - 10 cores)", "type": "METAL"}, {"name": "Apple M4", "type": "CPU"}]
        self.assertEqual(engine.device(listed), ("GPU", ["Apple M4 (GPU - 10 cores)"]))

    def test_cycles_falls_back_to_the_cpu_with_no_metal_gpu(self):
        self.assertEqual(engine.device([{"name": "Intel Core i9", "type": "CPU"}]), ("CPU", []))
        self.assertEqual(engine.device([]), ("CPU", []))

    def test_the_final_settings_never_drop_below_production_quality(self):
        f = engine.FINAL
        self.assertEqual((f["engine"], f["denoiser"], f["persistent_data"]), ("CYCLES", "OPENIMAGEDENOISE", True))
        self.assertGreaterEqual(f["samples"], 128)
        self.assertLessEqual(f["adaptive_threshold"], 0.01)

    def test_the_final_settings_are_the_ones_the_timing_test_ran(self):
        f = engine.FINAL
        self.assertEqual((f["samples"], f["adaptive_threshold"], f["adaptive_min_samples"]), (256, 0.01, 0))


class RenderChunks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = before()
        cls.motion, _ = route.build(cls.spec)
        cls.seen = chunks.hazard_frames(cls.spec, cls.motion)

    def test_hazard_frames_are_frames_that_see_a_near_hazard_box(self):
        n = self.motion["frame_count"]
        self.assertTrue(self.seen)
        self.assertLess(len(self.seen), n)
        self.assertTrue(all(1 <= f <= n for f in self.seen))
        cam = self.motion["camera"]
        standoff = route.params(self.spec)["standoff_in"]
        boxes = route.hazard_boxes(self.spec)
        reach = [(h["distance_in"] + standoff + chunks.REACH_IN, boxes[h["id"]]) for h in self.spec["hazards"]]
        for f in (min(self.seen), max(self.seen), next(f for f in range(1, n + 1) if f not in self.seen)):
            pose = self.motion["samples"][f - 1]
            sees = any(math.dist(c, pose["pos_in"]) <= r and geom.in_frame(geom.project(c, pose, cam), cam)
                       for r, box in reach for c in chunks.box_corners(box))
            self.assertEqual(sees, f in self.seen, f)

    def test_a_far_hazard_out_of_reach_is_not_a_hazard_frame(self):
        doc = before()
        doc["hazards"] = [h for h in doc["hazards"] if h["id"] == "wood-pile-far-left"]
        near = chunks.hazard_frames(doc, self.motion)
        with mock.patch.object(chunks, "REACH_IN", -10 ** 6):
            self.assertEqual(chunks.hazard_frames(doc, self.motion), set())
        self.assertTrue(near)
        self.assertLess(len(near), len(self.seen))

    def test_a_hazard_frame_reaches_60_in_past_the_wall_distance_and_the_standoff(self):
        doc = before()
        h = doc["hazards"][0]
        doc["hazards"] = [h]
        corner = chunks.box_corners(route.hazard_boxes(doc)[h["id"]])[0]
        reach = h["distance_in"] + route.params(doc)["standoff_in"] + 60
        cam = self.motion["camera"]

        def pose(frame, away):
            at = [corner[0] - away, corner[1], corner[2]]
            heading = math.degrees(math.atan2(corner[0] - at[0], corner[1] - at[1])) % 360
            return {"frame": frame, "pos_in": at, "heading_deg": heading, "tilt_deg": 0.0, "roll_deg": 0.0}

        near, far = pose(1, reach - 0.01), pose(2, reach + 0.5)
        self.assertTrue(geom.in_frame(geom.project(corner, far, cam), cam))
        self.assertEqual(chunks.hazard_frames(doc, {"camera": cam, "samples": [near, far]}), {1})

    def test_chunks_cover_the_walk_once_most_hazard_frames_first(self):
        plan = chunks.plan(self.motion["frame_count"], self.seen, 300)
        frames = sorted(f for c in plan for f in range(c["start_frame"], c["end_frame"] + 1))
        self.assertEqual(frames, list(range(1, self.motion["frame_count"] + 1)))
        counts = [c["hazard_frames"] for c in plan]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertGreater(counts[0], counts[-1])
        for c in plan:
            self.assertLessEqual(c["end_frame"] - c["start_frame"] + 1, 300)
            span = set(range(c["start_frame"], c["end_frame"] + 1))
            self.assertEqual(c["hazard_frames"], len(span & self.seen))
        self.assertEqual(chunks.plan(7, {2, 6, 7}, 3), [
            {"start_frame": 1, "end_frame": 3, "hazard_frames": 1},
            {"start_frame": 4, "end_frame": 6, "hazard_frames": 1},
            {"start_frame": 7, "end_frame": 7, "hazard_frames": 1},
        ])
        self.assertEqual([c["start_frame"] for c in chunks.plan(6, {5, 6}, 2)], [5, 1, 3])

    def test_a_chunk_size_under_one_frame_is_refused(self):
        with self.assertRaises(ValueError):
            chunks.plan(100, set(), 0)

    def test_a_render_chunk_resumes_and_skips_frames_already_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            for f in (3, 4, 6):
                with open(os.path.join(tmp, chunks.frame_name(f)), "wb") as out:
                    out.write(b"png")
            open(os.path.join(tmp, chunks.frame_name(5)), "wb").close()
            open(os.path.join(tmp, chunks.frame_name(7) + ".part"), "wb").close()
            chunk = {"start_frame": 2, "end_frame": 8, "hazard_frames": 3}
            self.assertEqual(chunks.todo(chunk, tmp), [2, 5, 7, 8])
            self.assertEqual(chunks.todo({"start_frame": 3, "end_frame": 4, "hazard_frames": 0}, tmp), [])

    def test_frame_files_are_synthetic_and_ordered(self):
        self.assertEqual(chunks.frame_name(7), "synthetic-frame-00007.png")
        self.assertLess(chunks.frame_name(99), chunks.frame_name(100))


def grey(v):
    return [v, v, v]


def region_grid(region, values, rows=4):
    return [[(region, grey(v)) for v in values] for _ in range(rows)]


class Stills(unittest.TestCase):
    """the driveway and the sky must not be stark white: the still check wants detail in them"""

    def faults(self, *grids):
        return stills.faults(stills.region_stats([row for g in grids for row in g]))

    def test_a_textured_driveway_a_graded_sky_and_lit_glass_pass(self):
        drive = region_grid("driveway", [0.42, 0.5, 0.46, 0.55] * 5)
        sky = [[("sky", grey(0.4 + 0.05 * r))] * 20 for r in range(6)]
        glass = region_grid("glass", [0.1] * 20)
        self.assertEqual(self.faults(drive, sky, glass), [])

    def test_todays_flat_white_driveway_is_refused(self):
        got = self.faults(region_grid("driveway", [0.77] * 20))
        self.assertEqual([f.split(" (")[0] for f in got], ["driveway is near white", "driveway is flat, no texture"])

    def test_a_flat_grey_driveway_is_refused_for_no_texture(self):
        got = self.faults(region_grid("driveway", [0.5, 0.505] * 10))
        self.assertEqual([f.split(" (")[0] for f in got], ["driveway is flat, no texture"])

    def test_a_driveway_with_grain_at_the_line_passes(self):
        self.assertEqual(self.faults(region_grid("driveway", [0.5, 0.515625] * 10)), [])
        self.assertEqual(len(self.faults(region_grid("driveway", [0.5, 0.5078125] * 10))), 1)

    def test_todays_pale_flat_sky_is_refused(self):
        got = self.faults(region_grid("sky", [0.708] * 20))
        self.assertEqual([f.split(" (")[0] for f in got], ["sky is near white", "sky is flat, no gradient or cloud"])

    def test_a_sky_with_spread_at_the_line_passes(self):
        sky = [[("sky", grey(v))] * 20 for v in (0.46875, 0.53125)]
        self.assertEqual(self.faults(sky), [])
        sky = [[("sky", grey(v))] * 20 for v in (0.4765625, 0.5234375)]
        self.assertEqual([f.split(" (")[0] for f in self.faults(sky)], ["sky is flat, no gradient or cloud"])

    def test_white_is_judged_from_0_6875_up(self):
        for region in ("driveway", "sky"):
            at = [[(region, grey(0.6875))] * 20] * 2
            under = [[(region, grey(0.68359375))] * 20] * 2
            self.assertEqual(len([f for f in self.faults(at) if "near white" in f]), 1, region)
            self.assertEqual([f for f in self.faults(under) if "near white" in f], [], region)

    def test_todays_black_glass_is_refused_and_dim_glass_passes(self):
        self.assertEqual([f.split(" (")[0] for f in self.faults(region_grid("glass", [0.019] * 20))], ["glass is near pure black"])
        self.assertEqual(self.faults(region_grid("glass", [0.0625] * 20)), [])
        self.assertEqual(len(self.faults(region_grid("glass", [0.0624] * 20))), 1)

    def test_a_region_under_40_pixels_is_not_judged(self):
        self.assertEqual(self.faults([[("glass", grey(0.0))] * 39]), [])
        self.assertEqual(len(self.faults([[("glass", grey(0.0))] * 40])), 1)

    def test_grain_counts_only_neighbours_in_the_same_region(self):
        row = []
        for _ in range(20):
            row += [("driveway", grey(0.3)), ("sky", grey(0.9)), None]
        st = stills.region_stats([row] * 3)
        self.assertEqual((st["driveway"]["grain"], st["sky"]["grain"]), (0.0, 0.0))
        st = stills.region_stats([[("driveway", grey(0.3)), ("driveway", grey(0.5)), ("driveway", grey(0.4))]])
        self.assertAlmostEqual(st["driveway"]["grain"], 0.15, places=6)
        self.assertEqual(st["driveway"]["pixels"], 3)
        self.assertAlmostEqual(st["driveway"]["mean"], 0.4, places=6)

    def test_luminance_weights_green_most(self):
        self.assertAlmostEqual(stills.luminance([1.0, 0.0, 0.0]), 0.2126, places=6)
        self.assertAlmostEqual(stills.luminance([0.0, 1.0, 0.0]), 0.7152, places=6)
        self.assertAlmostEqual(stills.luminance([0.0, 0.0, 1.0]), 0.0722, places=6)
        self.assertAlmostEqual(stills.region_stats(region_grid("sky", [0.2, 0.6], 1))["sky"]["spread"], 0.2, places=6)

    def test_an_unknown_region_is_refused(self):
        with self.assertRaises(stills.StillError):
            stills.region_stats([[("roof", grey(0.5))]])

    def test_a_value_outside_0_to_1_or_a_short_pixel_is_refused(self):
        for bad in ([1.2, 0.5, 0.5], [-0.1, 0.5, 0.5], [0.5, 0.5]):
            with self.assertRaises(stills.StillError, msg=bad):
                stills.region_stats([[("sky", bad)]])
        self.assertEqual(stills.region_stats([[("sky", [1.0, 0.0, 0.0])]])["sky"]["pixels"], 1)


if __name__ == "__main__":
    unittest.main()
