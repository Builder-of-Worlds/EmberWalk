import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import support
from ewscene import assets, house

BEFORE = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json")
CHANGES = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-after", "changes.json")
CHECK = os.path.join(support.BLENDER_DIR, "check_house.py")
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
        self.assertEqual(sorted(doc["look"]), ["ground", "light", "roof", "siding", "trim"])
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
    """The hero spec on a U footprint opening south, the notch notch_w wide from x 240, with no roof, structures or hazards."""
    doc = before()
    east = 240 + notch_w
    corners = [("left", [0, 0]), ("back", [0, 600]), ("right", [720, 600]), ("front", [720, 0]),
               ("east_arm", [east, 0]), ("notch_back", [east, 360]), ("west_arm", [240, 360]), ("front_left", [240, 0])]
    doc["footprint"] = [{"side": name, "start_in": c} for name, c in corners]
    doc["sides"] = {e["side"]: {"length_in": e["length_in"], "height_in": 108, "facing": e["facing"], "clean": False} for e in house.edges(doc)}
    doc["front_door"]["along_in"] = 40
    doc["structures"], doc["hazards"] = [], []
    del doc["house"]["roof"]
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


if __name__ == "__main__":
    unittest.main()
