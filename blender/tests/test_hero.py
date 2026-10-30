import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import house, maskbox, probe, route, truth
from ewscene.herocheck import (CATALOG, RULES, after_problems, box_problems, findings, route_problems,
                               spec_problems, truth_problems, visibility_problems)

FIXTURES = os.path.join(support.REPO_DIR, "fixtures", "synthetic")
SEEN_PX = 5000
IMAGE_BOX = [100, 100, 200, 200]


def load(scene, name, root=FIXTURES):
    return support.load_json(os.path.join(root, scene, name))


def fake_pass(doc, walk):
    ids = [h["id"] for h in findings(doc)]
    frames = []
    for n in range(1, walk["frame_count"] + 1):
        boxes = dict.fromkeys(ids)
        for i, hazard_id in enumerate(ids):
            if 30 * i < n <= 30 * i + 20:
                boxes[hazard_id] = {"box_px": list(IMAGE_BOX), "area_px": SEEN_PX}
        frames.append({"frame": n, "boxes": boxes})
    return {"schema": truth.PASS_SCHEMA, "width": walk["camera"]["width_px"], "height": walk["camera"]["height_px"], "frames": frames}


def video_record(walk):
    ff = {
        "streams": [{
            "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "width": walk["camera"]["width_px"],
            "height": walk["camera"]["height_px"], "avg_frame_rate": "%d/1" % walk["fps"], "duration": str(walk["duration_s"]),
            "nb_read_frames": walk["frame_count"],
        }],
        "format": {"duration": str(walk["duration_s"])},
    }
    settings = {"engine": "CYCLES", "samples": 64, "render_seconds": 1, "blender": "5.2.2", "machine": "test"}
    return probe.record(walk["scene"], "%s/walk.mp4" % walk["scene"], ff, 1000, "0" * 64, settings)


def made(spec, changes_doc=None):
    if changes_doc is not None:
        spec = house.after_spec(spec, changes_doc, CATALOG, RULES)
    walk, parts = route.build(spec)
    doc = truth.attach_boxes(house.truth_from_spec(spec, RULES), fake_pass(house.truth_from_spec(spec, RULES), walk), walk)
    return spec, walk, parts, doc, video_record(walk)


class GoodSet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = copy.deepcopy(load("hero-before", "spec.json"))
        cls.changes = copy.deepcopy(load("hero-after", "changes.json"))
        _, cls.walk, cls.parts, cls.doc, cls.record = made(cls.spec)
        cls.after_spec, cls.after_walk, cls.after_parts, cls.after_doc, cls.after_record = made(cls.spec, cls.changes)

    def doc_copy(self):
        return copy.deepcopy(self.doc)

    def problems(self, doc=None, record=None):
        return truth_problems(self.spec, doc or self.doc, self.walk, record or self.record)

    def assertRefused(self, problems, words):
        self.assertTrue(any(words in p for p in problems), "no problem names %r in %s" % (words, problems))

    def test_a_truth_made_from_the_spec_and_a_full_pass_has_no_problems(self):
        self.assertEqual(self.problems(), [])

    def test_the_after_set_has_no_problems(self):
        self.assertEqual(truth_problems(self.after_spec, self.after_doc, self.after_walk, self.after_record), [])
        self.assertEqual(after_problems(self.after_doc, self.changes, self.walk, self.parts, self.after_walk, self.after_parts), [])

    def test_a_truth_missing_a_spec_hazard_is_refused(self):
        doc = self.doc_copy()
        doc["hazards"] = [h for h in doc["hazards"] if h["id"] != "shed-right"]
        self.assertRefused(self.problems(doc), "shed-right")

    def test_a_truth_with_a_hazard_the_spec_lacks_is_refused(self):
        doc = self.doc_copy()
        extra = copy.deepcopy(doc["hazards"][0])
        extra["id"] = "invented-hazard"
        doc["hazards"].append(extra)
        self.assertRefused(self.problems(doc), "invented-hazard")

    def test_a_hazard_without_a_rule_id_is_refused(self):
        doc = self.doc_copy()
        del doc["hazards"][3]["rule_id"]
        self.assertRefused(self.problems(doc), "%s has no rule_id" % doc["hazards"][3]["id"])

    def test_a_hazard_without_a_side_or_band_is_refused(self):
        for key in ("side", "band"):
            doc = self.doc_copy()
            del doc["hazards"][2][key]
            self.assertRefused(self.problems(doc), "%s has no %s" % (doc["hazards"][2]["id"], key))

    def test_a_band_that_differs_from_the_spec_is_refused(self):
        doc = self.doc_copy()
        doc["hazards"][0]["band"] = "5_30"
        self.assertRefused(self.problems(doc), "band is 5_30")

    def test_a_truth_the_house_check_refuses_is_reported(self):
        doc = self.doc_copy()
        doc["hazards"][1]["rule_id"] = "no-such-rule"
        self.assertRefused(self.problems(doc), "the house check refuses the truth")

    def test_a_hazard_inside_30_ft_of_the_clean_side_is_refused(self):
        doc = self.doc_copy()
        grass = next(h for h in doc["hazards"] if h["id"] == "tall-grass-back")
        grass.update(distance_in=359, band="5_30", rule_id="ca-dry-grass-ccr-z1")
        self.assertRefused(self.problems(doc), "clean side back")

    def test_fewer_than_two_visible_0_5_hazards_is_refused(self):
        doc = self.doc_copy()
        near = [h for h in doc["hazards"] if h["band"] == "0_5"]
        for h in near[1:]:
            h["frame_boxes"] = []
        self.assertRefused(self.problems(doc), "1 hazards in 0_5 are visible")

    def test_no_visible_30_100_hazard_is_refused(self):
        doc = self.doc_copy()
        for h in doc["hazards"]:
            if h["band"] == "30_100":
                h["frame_boxes"] = []
        self.assertRefused(self.problems(doc), "no hazard in 30_100 is visible")

    def test_a_hazard_seen_with_199_pixels_is_not_visible_and_200_is(self):
        for area, ok in ((199, False), (200, True)):
            doc = self.doc_copy()
            grass = next(h for h in doc["hazards"] if h["id"] == "tall-grass-back")
            wood = next(h for h in doc["hazards"] if h["id"] == "wood-pile-far-left")
            for h in (grass, wood):
                h["frame_boxes"] = [dict(h["frame_boxes"][0], area_px=area)]
            self.assertEqual(any("30_100" in p and "visible" in p for p in visibility_problems(doc)), not ok)

    def test_a_frame_outside_the_walk_is_refused(self):
        for frame in (0, self.walk["frame_count"] + 1, 1.5, True):
            doc = self.doc_copy()
            doc["hazards"][0]["frame_boxes"][0]["frame"] = frame
            self.assertRefused(self.problems(doc), "not a frame of the %d frame walk" % self.walk["frame_count"])

    def test_the_last_frame_of_the_walk_is_allowed(self):
        doc = self.doc_copy()
        doc["hazards"][0]["frame_boxes"][0]["frame"] = self.walk["frame_count"]
        self.assertEqual(box_problems(doc, self.walk), [])

    def test_a_box_outside_the_image_is_refused(self):
        width = self.walk["camera"]["width_px"]
        for box in ([0, 0, width + 1, 50], [-1, 0, 50, 50], [10, 10, 10, 50]):
            doc = self.doc_copy()
            doc["hazards"][0]["frame_boxes"][0]["box_px"] = box
            self.assertRefused(self.problems(doc), "is outside the")

    def test_a_frame_box_under_200_pixels_is_refused_and_200_is_allowed(self):
        doc = self.doc_copy()
        row = doc["hazards"][0]["frame_boxes"][0]
        row["area_px"] = maskbox.MIN_MASK_PX - 1
        self.assertRefused(box_problems(doc, self.walk), "199 mask pixels")
        row["area_px"] = maskbox.MIN_MASK_PX
        self.assertEqual(box_problems(doc, self.walk), [])

    def test_a_box_on_the_image_edge_is_allowed(self):
        doc = self.doc_copy()
        doc["hazards"][0]["frame_boxes"][0]["box_px"] = [0, 0, self.walk["camera"]["width_px"], self.walk["camera"]["height_px"]]
        self.assertEqual(box_problems(doc, self.walk), [])

    def test_a_render_record_for_another_scene_is_refused(self):
        record = dict(self.record, scene="hero-after")
        self.assertRefused(self.problems(record=record), "render.json names scene hero-after")

    def test_a_truth_for_another_scene_is_refused(self):
        doc = self.doc_copy()
        doc["scene"] = "hero-after"
        self.assertRefused(self.problems(doc), "truth names scene hero-after")

    def test_a_render_record_with_another_fps_or_length_is_refused(self):
        self.assertRefused(self.problems(record=dict(self.record, fps=30)), "fps, expected")
        self.assertRefused(self.problems(record=dict(self.record, frame_count=self.walk["frame_count"] - 1)), "frames, expected")
        self.assertRefused(self.problems(record=dict(self.record, duration_s=self.walk["duration_s"] + 1)), "s long, expected")

    def after_check(self, doc=None, walk=None, parts=None):
        return after_problems(doc or self.after_doc, self.changes, self.walk, self.parts, walk or self.after_walk, parts or self.after_parts)

    def test_an_after_truth_that_keeps_a_required_now_hazard_is_refused(self):
        doc = copy.deepcopy(self.after_doc)
        doc["hazards"].append(copy.deepcopy(next(h for h in self.doc["hazards"] if h["label"] == "required_now")))
        self.assertRefused(self.after_check(doc), "keeps required_now hazard")

    def test_an_after_truth_that_drops_a_kept_recommended_hazard_is_refused(self):
        doc = copy.deepcopy(self.after_doc)
        doc["hazards"] = [h for h in doc["hazards"] if h["id"] != "fence-at-siding"]
        self.assertRefused(self.after_check(doc), "changes.json keeps")

    def test_an_after_truth_that_keeps_a_removed_recommended_hazard_is_refused(self):
        doc = copy.deepcopy(self.after_doc)
        doc["hazards"].append(copy.deepcopy(next(h for h in self.doc["hazards"] if h["id"] == "trash-cans-right")))
        self.assertRefused(self.after_check(doc), "changes.json keeps")

    def test_an_after_walk_of_another_length_is_refused(self):
        walk = dict(self.after_walk, frame_count=self.after_walk["frame_count"] - 1)
        self.assertRefused(self.after_check(walk=walk), "frame_count")

    def test_an_after_walk_on_another_route_is_refused(self):
        walk = copy.deepcopy(self.after_walk)
        walk["samples"][100]["pos_in"][0] += 1
        self.assertRefused(self.after_check(walk=walk), "samples")
        parts = copy.deepcopy(self.after_parts)
        parts["parts"].pop()
        self.assertRefused(self.after_check(parts=parts), "parts differ")

    def test_the_after_walk_is_the_before_walk_with_only_the_scene_renamed(self):
        self.assertEqual(route_problems(self.walk, self.parts, self.after_walk, self.after_parts), [])
        self.assertNotEqual(self.walk["scene"], self.after_walk["scene"])


class CommittedSpec(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = load("hero-before", "spec.json")
        cls.changes = load("hero-after", "changes.json")
        cls.doc = house.truth_from_spec(cls.spec, RULES)

    def test_every_spec_hazard_has_a_truth_entry_with_band_side_and_rule_id(self):
        self.assertEqual(spec_problems(self.spec, self.doc), [])
        for h in self.doc["hazards"]:
            self.assertTrue(h["band"] and h["side"] and h["rule_id"], h["id"])

    def test_the_demo_bar_two_0_5_hazards_and_one_30_100_hazard_is_in_the_spec(self):
        bands = [h["band"] for h in self.spec["hazards"]]
        self.assertGreaterEqual(bands.count("0_5"), 2)
        self.assertGreaterEqual(bands.count("30_100"), 1)

    def test_changes_json_keeps_only_hazards_the_spec_labels_recommended(self):
        label = {h["id"]: h["label"] for h in self.spec["hazards"]}
        kept = [e["id"] for e in self.changes["hazards"] if e["change"] == "kept"]
        self.assertTrue(kept)
        self.assertEqual({label[i] for i in kept}, {"recommended"})

    def test_the_after_spec_keeps_exactly_what_changes_json_keeps(self):
        after = house.after_spec(self.spec, self.changes, CATALOG, RULES)
        kept = sorted(e["id"] for e in self.changes["hazards"] if e["change"] == "kept")
        self.assertEqual(sorted(h["id"] for h in after["hazards"]), kept)
        self.assertFalse([h for h in after["hazards"] if h["label"] == "required_now"])


CHECK = os.path.join(support.BLENDER_DIR, "check_hero.py")
SCENE_FILES = ("truth.json", "motion.json", "parts.json", "render.json")


class CheckHero(unittest.TestCase):
    """check_hero.py on a folder holding a good set, so the kiln's files are judged by the same checks as GoodSet."""

    @classmethod
    def setUpClass(cls):
        cls.spec = load("hero-before", "spec.json")
        cls.changes = load("hero-after", "changes.json")

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = folder.name
        self.write("hero-before", {"spec.json": self.spec})
        self.write("hero-after", {"changes.json": self.changes})
        for scene, changes_doc in (("hero-before", None), ("hero-after", self.changes)):
            _, walk, parts, doc, record = made(self.spec, changes_doc)
            self.write(scene, {"motion.json": walk, "parts.json": parts, "truth.json": doc, "render.json": record})

    def write(self, scene, files):
        os.makedirs(os.path.join(self.root, scene), exist_ok=True)
        for name, body in files.items():
            with open(os.path.join(self.root, scene, name), "w", encoding="utf-8") as f:
                json.dump(body, f)

    def read(self, scene, name):
        return load(scene, name, self.root)

    def run_check(self, root=None):
        return subprocess.run([sys.executable, CHECK, "--fixtures", root or self.root], capture_output=True, text=True)

    def test_a_good_set_exits_0_and_names_both_scenes(self):
        r = self.run_check()
        self.assertEqual((r.returncode, r.stderr), (0, ""))
        for scene in ("hero-before", "hero-after"):
            self.assertIn("EW_OK %s" % scene, r.stdout)

    def test_every_missing_file_exits_2_and_is_named(self):
        for scene, name in [("hero-before", n) for n in ("spec.json",) + SCENE_FILES] + [("hero-after", n) for n in ("changes.json",) + SCENE_FILES]:
            path = os.path.join(self.root, scene, name)
            with open(path, "rb") as f:
                body = f.read()
            os.remove(path)
            try:
                r = self.run_check()
                self.assertEqual(r.returncode, 2, "%s/%s: %s" % (scene, name, r.stderr))
                self.assertIn("EW_MISSING %s/%s" % (scene, name), r.stderr)
            finally:
                with open(path, "wb") as f:
                    f.write(body)
        self.assertEqual(self.run_check().returncode, 0)

    def test_an_empty_folder_exits_2_and_never_0(self):
        with tempfile.TemporaryDirectory() as empty:
            r = self.run_check(empty)
        self.assertEqual(r.returncode, 2)
        self.assertIn("EW_MISSING hero-before/truth.json", r.stderr)

    def test_a_missing_file_outranks_a_problem(self):
        doc = self.read("hero-before", "truth.json")
        self.write("hero-before", {"truth.json": dict(doc, hazards=doc["hazards"][1:])})
        os.remove(os.path.join(self.root, "hero-after", "render.json"))
        r = self.run_check()
        self.assertEqual(r.returncode, 2)
        self.assertIn("EW_MISSING hero-after/render.json", r.stderr)
        self.assertIn("EW_PROBLEM hero-before", r.stderr)

    def test_a_before_truth_missing_a_hazard_exits_1_and_names_it(self):
        doc = self.read("hero-before", "truth.json")
        self.write("hero-before", {"truth.json": dict(doc, hazards=doc["hazards"][1:])})
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("EW_PROBLEM hero-before", r.stderr)
        self.assertIn(doc["hazards"][0]["id"], r.stderr)
        self.assertNotIn("EW_OK hero-before", r.stdout)
        self.assertIn("EW_OK hero-after", r.stdout)

    def test_a_tampered_after_walk_exits_1(self):
        walk = self.read("hero-after", "motion.json")
        walk["samples"][50]["pos_in"][1] += 1
        self.write("hero-after", {"motion.json": walk})
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("EW_PROBLEM hero-after", r.stderr)

    def tamper_both(self, name, change):
        for scene in ("hero-before", "hero-after"):
            doc = self.read(scene, name)
            change(doc)
            self.write(scene, {name: doc})

    def assertBothScenesDifferFromTheRoute(self):
        r = self.run_check()
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("EW_PROBLEM hero-before: motion.json and parts.json differ from the route built from the spec", r.stderr)
        self.assertIn("EW_PROBLEM hero-after: motion.json and parts.json differ from the route built from the after spec", r.stderr)

    def test_motion_tampered_the_same_way_in_both_scenes_exits_1(self):
        def bump(walk):
            walk["samples"][50]["pos_in"][1] += 1
        self.tamper_both("motion.json", bump)
        self.assertBothScenesDifferFromTheRoute()

    def test_parts_tampered_the_same_way_in_both_scenes_exits_1(self):
        self.tamper_both("parts.json", lambda parts: parts["parts"].pop())
        self.assertBothScenesDifferFromTheRoute()

    def test_a_tampered_before_walk_alone_exits_1(self):
        walk = self.read("hero-before", "motion.json")
        walk["samples"][50]["pos_in"][1] += 1
        self.write("hero-before", {"motion.json": walk})
        r = self.run_check()
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("EW_PROBLEM hero-before: motion.json and parts.json differ from the route built from the spec", r.stderr)

    def test_an_after_truth_that_keeps_a_required_now_hazard_exits_1(self):
        doc = self.read("hero-after", "truth.json")
        doc["hazards"][0]["label"] = "required_now"
        self.write("hero-after", {"truth.json": doc})
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("keeps required_now hazard", r.stderr)

    def test_a_render_record_for_another_scene_exits_1(self):
        record = self.read("hero-before", "render.json")
        self.write("hero-before", {"render.json": dict(record, scene="hero-after")})
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("render.json names scene hero-after", r.stderr)

    def test_a_file_that_is_not_json_exits_1(self):
        with open(os.path.join(self.root, "hero-before", "parts.json"), "w", encoding="utf-8") as f:
            f.write("{not json")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("EW_PROBLEM hero-before/parts.json", r.stderr)


if __name__ == "__main__":
    unittest.main()
