import copy
import hashlib
import os
import tempfile
import unittest

import support
from ewscene import assets, geom, house, recheck, route, schema, truth
from test_house_masks import BLENDER, BUILD_HOUSE, CHANGES, HERO, MASKS, blender

CATALOG = assets.load_catalog()
RULES = house.load_rules()
FIXTURES = os.path.join(support.REPO_DIR, "fixtures", "synthetic")


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def boxes_for(walk, areas):
    frames = []
    for n in range(1, walk["frame_count"] + 1):
        found = {}
        for hazard_id, by_frame in areas.items():
            area = by_frame.get(n)
            found[hazard_id] = {"box_px": [10, 10, 10 + max(area // 10, 20), 20 + 10], "area_px": area} if area else None
        frames.append({"frame": n, "boxes": found})
    cam = walk["camera"]
    return {"schema": truth.PASS_SCHEMA, "width": cam["width_px"], "height": cam["height_px"], "frames": frames}


class Recheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = support.load_json(os.path.join(FIXTURES, "hero-before", "spec.json"))
        house.validate(spec, CATALOG, RULES)
        cls.before_spec = copy.deepcopy(spec)
        house.roof_prisms(spec)
        cls.motion, _ = route.build(spec)
        plain = house.truth_from_spec(spec, RULES)
        cls.required = [h["id"] for h in plain["hazards"] if h["label"] == "required_now"]
        cls.recommended = [h["id"] for h in plain["hazards"] if h["label"] == "recommended"]
        cls.areas = {}
        for i, hazard_id in enumerate(h["id"] for h in plain["hazards"]):
            cls.areas[hazard_id] = {20 + i: 400, 900 + i: 9000, 901 + i: 9000, 3000 + i: 5000}
        cls.before = truth.attach_boxes(plain, boxes_for(cls.motion, cls.areas), cls.motion)
        changes = support.load_json(os.path.join(FIXTURES, "hero-after", "changes.json"))
        cls.after = house.after_spec(cls.before_spec, changes, CATALOG, RULES)
        cls.fixed = [f["id"] for f in cls.after["fixed"]]
        cls.removed = [i for i in cls.required if i not in cls.fixed]

    def results(self, area=None):
        out = {}
        for hazard_id in self.required:
            gone = recheck.fate(self.after, hazard_id) == "removed"
            out[hazard_id] = {"sha256": sha(hazard_id), "area_px": 0 if gone else (area or 3000)}
        return out

    def doc(self):
        return recheck.build(self.before, self.motion, self.after, self.results())

    def refused(self, doc, text, kind="refused"):
        with self.assertRaises(recheck.RecheckError) as caught:
            recheck.check(doc, self.before, self.motion, self.after)
        self.assertEqual(caught.exception.kind, kind)
        self.assertIn(text, str(caught.exception))

    def test_the_plan_has_one_entry_per_required_now_hazard_and_none_for_the_rest(self):
        plan = recheck.plan(self.before, self.motion)
        self.assertEqual([p["hazard_id"] for p in plan], self.required)
        self.assertEqual(len(plan), 12)
        for hazard_id in self.recommended:
            self.assertNotIn(hazard_id, [p["hazard_id"] for p in plan])

    def test_the_proof_frame_is_where_the_mask_area_is_largest_and_the_earliest_of_a_tie(self):
        plan = {p["hazard_id"]: p for p in recheck.plan(self.before, self.motion)}
        for hazard_id in self.required:
            index = [h["id"] for h in self.before["hazards"]].index(hazard_id)
            self.assertEqual(plan[hazard_id]["before_frame"], 900 + index, hazard_id)

    def test_the_pose_is_the_before_walks_sample_at_the_proof_frame(self):
        for p in recheck.plan(self.before, self.motion):
            s = self.motion["samples"][p["before_frame"] - 1]
            self.assertEqual(p["pose"], {"pos_in": s["pos_in"], "heading_deg": s["heading_deg"], "tilt_deg": s["tilt_deg"], "roll_deg": s["roll_deg"]})

    def test_a_hazard_the_walk_never_shows_has_no_proof_frame(self):
        gone = copy.deepcopy(self.before)
        gone["hazards"][0]["frame_boxes"] = []
        with self.assertRaises(recheck.RecheckError) as caught:
            recheck.plan(gone, self.motion)
        self.assertIn("%s is never in view in the before walk" % gone["hazards"][0]["id"], str(caught.exception))

    def test_the_fate_of_each_hazard_follows_the_changes(self):
        self.assertEqual({recheck.fate(self.after, i) for i in self.required}, {"removed", "fixed"})
        fates = {i: recheck.fate(self.after, i) for i in self.recommended}
        self.assertEqual(fates, {"fence-at-siding": "kept", "trash-cans-right": "removed", "patio-furniture-front": "removed"})

    def test_a_built_document_passes_its_schema_and_the_check(self):
        doc = self.doc()
        self.assertEqual(schema.errors(doc, schema.load("recheck")), [])
        recheck.check(doc, self.before, self.motion, self.after)
        self.assertEqual([s["hazard_id"] for s in doc["stills"]], self.required)
        self.assertEqual(doc["stills"][0]["file"], "synthetic-recheck-%s.png" % self.required[0])
        self.assertEqual((doc["scene"], doc["before"]), (self.after["id"], self.before["scene"]))

    def test_a_removed_hazard_has_area_0_and_a_fixed_one_keeps_its_new_box(self):
        results = self.results()
        fixed = self.fixed[0]
        results[fixed]["box_px"] = [5, 6, 50, 60]
        doc = recheck.build(self.before, self.motion, self.after, results)
        by_id = {s["hazard_id"]: s for s in doc["stills"]}
        self.assertEqual(by_id[fixed]["box_px"], [5, 6, 50, 60])
        self.assertEqual({by_id[i]["area_px"] for i in self.removed}, {0})

    def test_the_malformed_are_invalid(self):
        self.refused("not a document", "not an object", "invalid")
        doc = self.doc()
        del doc["stills"][0]["sha256"]
        self.refused(doc, "sha256", "invalid")
        doc = self.doc()
        doc["schema"] = "emberwalk.recheck/2"
        self.refused(doc, "emberwalk.recheck/1", "invalid")
        doc = self.doc()
        doc["stills"][0]["file"] = "recheck.png"
        self.refused(doc, "file", "invalid")

    def test_a_still_for_a_recommended_hazard_is_refused(self):
        doc = self.doc()
        extra = copy.deepcopy(doc["stills"][0])
        extra["hazard_id"] = self.recommended[0]
        extra["file"] = "synthetic-recheck-%s.png" % self.recommended[0]
        doc["stills"].append(extra)
        self.refused(doc, "%s is not a required_now hazard of the before scene" % self.recommended[0])

    def test_a_required_now_hazard_without_its_still_is_refused(self):
        doc = self.doc()
        doc["stills"].pop()
        self.refused(doc, "%s has no recheck still" % self.required[-1])

    def test_two_stills_for_one_hazard_are_refused(self):
        doc = self.doc()
        doc["stills"].append(copy.deepcopy(doc["stills"][0]))
        self.refused(doc, "%s has more than one recheck still" % self.required[0])

    def test_a_proof_frame_outside_the_before_walk_is_refused(self):
        frame = self.motion["frame_count"] + 1
        doc = self.doc()
        doc["stills"][0]["before_frame"] = frame
        self.refused(doc, "before_frame %d is outside the before walk" % frame)

    def test_a_proof_frame_before_the_first_is_invalid(self):
        doc = self.doc()
        doc["stills"][0]["before_frame"] = 0
        self.refused(doc, "before_frame", "invalid")

    def test_a_proof_frame_that_is_not_the_largest_mask_area_is_refused(self):
        doc = self.doc()
        doc["stills"][0]["before_frame"] += 1000
        self.refused(doc, "is not the frame where %s shows the most mask pixels" % self.required[0])

    def test_a_pose_that_differs_from_the_before_sample_is_refused(self):
        doc = self.doc()
        doc["stills"][0]["pose"]["heading_deg"] += 0.001
        self.refused(doc, "pose differs from the before walk's sample at frame")

    def test_a_removed_hazard_with_pixels_in_the_after_mask_is_refused(self):
        doc = self.doc()
        removed = next(s for s in doc["stills"] if s["hazard_id"] == self.removed[0])
        removed["area_px"] = 250
        self.refused(doc, "%s was removed but shows 250 mask pixels" % self.removed[0])

    def test_a_still_file_that_names_another_hazard_is_refused(self):
        doc = self.doc()
        doc["stills"][0]["file"] = "synthetic-recheck-%s.png" % self.required[1]
        self.refused(doc, "file must be synthetic-recheck-%s.png" % self.required[0])

    def test_a_recheck_of_another_before_scene_is_refused(self):
        doc = self.doc()
        doc["before"] = "hero-other"
        self.refused(doc, "the before scene is %s" % self.before["scene"])

    def test_a_still_from_another_scene_is_refused(self):
        doc = self.doc()
        doc["scene"] = "hero-other"
        self.refused(doc, "the after scene is %s" % self.after["id"])


RENDER = os.path.join(support.BLENDER_DIR, "render_recheck.py")


def seen_frames(found, ids):
    best = {}
    for f in found["frames"]:
        for hazard_id in ids:
            hit = f["boxes"].get(hazard_id)
            if hit and (hazard_id not in best or hit["area_px"] > best[hazard_id][0]):
                best[hazard_id] = (hit["area_px"], f["frame"])
    return {i: frame for i, (_, frame) in best.items()}


class PoseMatch(unittest.TestCase):
    POSE = {"pos_in": [300.0, -132.0, 54.0], "heading_deg": 12.0, "tilt_deg": 8.0, "roll_deg": 0.5}

    def gap(self, pos=None, **turn):
        want = self.POSE
        got = dict(want, **turn)
        return recheck.pose_problem(pos or want["pos_in"], geom.camera_rotation(got["heading_deg"], got["tilt_deg"], got["roll_deg"]), dict(want, file="synthetic-recheck-x.png", hazard_id="x", before_frame=7))

    def test_the_pose_it_was_asked_for_matches(self):
        self.assertIsNone(self.gap())

    def test_a_position_off_by_less_than_the_tolerance_matches(self):
        self.assertIsNone(self.gap([300.04, -132.0, 54.0]))

    def test_a_position_off_by_more_than_the_tolerance_is_a_problem(self):
        self.assertIn("position", self.gap([300.0, -132.0, 54.2]))

    def test_a_heading_tilt_or_roll_off_by_a_degree_is_a_problem(self):
        for key, value in (("heading_deg", 13.0), ("tilt_deg", 9.0), ("roll_deg", 1.5)):
            with self.subTest(key=key):
                text = self.gap(**{key: value})
                self.assertIn("direction", text)
                self.assertIn("frame 7", text)

    def test_a_turn_inside_the_tolerance_matches(self):
        self.assertIsNone(self.gap(heading_deg=12.04))

    def test_the_angle_is_measured_whichever_way_it_turns(self):
        self.assertIsNotNone(self.gap(heading_deg=11.0))
        self.assertIsNotNone(self.gap(tilt_deg=7.0))
        self.assertIsNotNone(self.gap(roll_deg=-0.5))


@unittest.skipUnless(BLENDER, "Blender not found: the recheck render test did not run, so this is a PARTIAL RUN")
class RecheckRender(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        spec = support.load_json(HERO)
        house.validate(spec, CATALOG, RULES)
        cls.after = house.after_spec(copy.deepcopy(spec), support.load_json(CHANGES), CATALOG, RULES)
        house.roof_prisms(spec)
        cls.walk, _ = route.build(spec)
        plain = house.truth_from_spec(spec, RULES)
        built = os.path.join(cls.tmp.name, "after")
        r = blender(["--python", BUILD_HOUSE, "--", HERO, "--changes", CHANGES, "--out", built])
        if r.returncode != 0:
            raise AssertionError("build failed: %s" % (r.stdout[-1500:] + r.stderr[-1500:]))
        boxes = os.path.join(cls.tmp.name, "boxes.json")
        r = blender([os.path.join(built, "scene.blend"), "--python", MASKS, "--", "--out", boxes, "--every", "50"])
        if r.returncode != 0:
            raise AssertionError("mask pass failed: %s" % (r.stdout[-1500:] + r.stderr[-1500:]))
        frames = seen_frames(support.load_json(boxes), [h["id"] for h in plain["hazards"]])
        for h in plain["hazards"]:
            n = frames.get(h["id"], 1)
            h["frame_boxes"] = [{"frame": n, "t": cls.walk["samples"][n - 1]["t"], "box_px": [10, 10, 400, 400], "area_px": 5000}]
        cls.truth = plain
        cls.paths = {name: os.path.join(cls.tmp.name, name) for name in ("truth.json", "motion.json", "recheck.json")}
        for name, body in (("truth.json", plain), ("motion.json", cls.walk)):
            with open(cls.paths[name], "w", encoding="utf-8") as f:
                f.write(truth.dumps(body))
        cls.stills = os.path.join(cls.tmp.name, "stills")
        cls.rendered = blender([os.path.join(built, "scene.blend"), "--python", RENDER, "--", "--spec", HERO, "--changes", CHANGES,
                           "--truth", cls.paths["truth.json"], "--motion", cls.paths["motion.json"], "--out", cls.stills, "--recheck", cls.paths["recheck.json"]])
        if cls.rendered.returncode != 0:
            raise AssertionError("recheck failed: %s" % (cls.rendered.stdout[-1500:] + cls.rendered.stderr[-1500:]))
        cls.doc = support.load_json(cls.paths["recheck.json"])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_still_per_required_now_hazard_with_the_hash_of_its_file(self):
        required = [h["id"] for h in self.truth["hazards"] if h["label"] == "required_now"]
        self.assertEqual([s["hazard_id"] for s in self.doc["stills"]], required)
        for s in self.doc["stills"]:
            with open(os.path.join(self.stills, s["file"]), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), s["sha256"])

    def test_the_written_document_passes_the_check(self):
        recheck.check(self.doc, self.truth, self.walk, self.after)

    def test_a_before_walk_that_looks_another_way_at_the_same_place_is_refused(self):
        turned = copy.deepcopy(self.walk)
        for s in turned["samples"]:
            s["heading_deg"] += 3.0
        path = os.path.join(self.tmp.name, "turned-motion.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(truth.dumps(turned))
        r = blender([os.path.join(self.tmp.name, "after", "scene.blend"), "--python", RENDER, "--", "--spec", HERO, "--changes", CHANGES,
                     "--truth", self.paths["truth.json"], "--motion", path, "--out", os.path.join(self.tmp.name, "turned"),
                     "--recheck", os.path.join(self.tmp.name, "turned-recheck.json")])
        self.assertEqual(r.returncode, 3, r.stderr[-1500:])
        self.assertIn("direction", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "turned-recheck.json")))

    def test_a_removed_hazard_has_no_mask_pixels_and_a_fixed_one_still_shows_with_its_box(self):
        fates = {s["hazard_id"]: recheck.fate(self.after, s["hazard_id"]) for s in self.doc["stills"]}
        self.assertEqual({s["area_px"] for s in self.doc["stills"] if fates[s["hazard_id"]] == "removed"}, {0})
        shown = [s for s in self.doc["stills"] if fates[s["hazard_id"]] == "fixed" and s["area_px"] > 0]
        self.assertGreaterEqual(len(shown), 1)
        for s in shown:
            self.assertEqual(len(s["box_px"]), 4)


if __name__ == "__main__":
    unittest.main()
