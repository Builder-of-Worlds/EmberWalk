import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import openart, route

CHECK = os.path.join(support.BLENDER_DIR, "check_openart.py")
VIEWS = ("front", "east", "west", "north", "after_front")
HEX = "0123456789abcdef" * 4


def digest(view, n):
    return hashlib.sha256(("%s-%d" % (view, n)).encode()).hexdigest()


def still(view, n, credits=10, chosen=False):
    s = {
        "view": view,
        "creation_id": "cr-%s-%d" % (view, n),
        "model": "flux-dev",
        "prompt": "A one storey ranch house on a foothill lot, %s view, candidate %d" % (view, n),
        "reference": {"kind": "board"} if view != "after_front" else {"kind": "blender_frame", "frame": 412},
        "credits": credits,
        "original": {"file": "synthetic-hero-%s-%d.png" % (view, n), "bytes": 2048000, "sha256": digest(view, n)},
    }
    if chosen:
        s.update({
            "chosen": True,
            "picked_by": "owner",
            "picked_on": "2026-10-28",
            "copy": {"file": "synthetic-hero-%s.jpg" % view, "bytes": 412000, "sha256": HEX},
        })
    return s


def look():
    stills = []
    for view in VIEWS:
        stills.append(still(view, 1, chosen=True))
        stills.append(still(view, 2, credits=12.5))
    return {
        "schema": "emberwalk.openart-look/1",
        "synthetic": True,
        "label": "Synthetic sample house",
        "scene": "hero-look",
        "front_side": "front",
        "credits_total": 112.5,
        "stills": stills,
    }


def first(doc, view):
    return next(s for s in doc["stills"] if s["view"] == view)


def run(doc):
    """Run the CLI on a document in a temporary folder; returns the result and what is left in the work folder."""
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "work")
        os.makedirs(work)
        path = os.path.join(tmp, "look.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(doc if isinstance(doc, str) else json.dumps(doc))
        r = subprocess.run([sys.executable, CHECK, "--look", path], cwd=work, capture_output=True, text=True)
        return r, sorted(os.listdir(work))


class LookNormal(unittest.TestCase):
    def test_one_chosen_still_per_view_passes(self):
        doc = openart.validate_look(look())
        self.assertEqual(doc["credits_total"], 112.5)

    def test_the_summary_prints_the_credit_total(self):
        line = openart.look_summary(look())
        self.assertIn("112.5 credits", line)
        self.assertIn("10 stills", line)
        self.assertIn("5 of 5 views picked", line)

    def test_the_cli_exits_0_with_one_line(self):
        r, left = run(look())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1)
        self.assertIn("112.5 credits", r.stdout)
        self.assertEqual(left, [])

    def test_a_still_with_no_reference_passes(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "none"}
        openart.validate_look(doc)

    def test_two_stills_from_one_creation_pass(self):
        doc = look()
        doc["stills"][1]["creation_id"] = doc["stills"][0]["creation_id"]
        openart.validate_look(doc)

    def test_a_still_made_from_a_listed_still_passes(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "still", "file": "synthetic-hero-front-2.png"}
        openart.validate_look(doc)

    def test_zero_credits_pass(self):
        doc = look()
        first(doc, "front")["credits"] = 0
        doc["credits_total"] = 102.5
        openart.validate_look(doc)


class LookInvalid(unittest.TestCase):
    def assertInvalid(self, doc, words):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_look(doc)
        self.assertEqual(e.exception.kind, "invalid")
        self.assertIn(words, str(e.exception))
        r, left = run(doc)
        self.assertEqual(r.returncode, 3)
        self.assertIn(words, r.stderr)
        self.assertEqual(left, [])

    def test_malformed_json(self):
        r, left = run("{ not json")
        self.assertEqual(r.returncode, 3)
        self.assertIn("openart invalid", r.stderr)
        self.assertEqual(left, [])

    def test_not_an_object(self):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_look([1, 2])
        self.assertEqual(e.exception.kind, "invalid")

    def test_a_missing_field(self):
        doc = look()
        del first(doc, "west")["model"]
        self.assertInvalid(doc, "missing model")

    def test_a_missing_top_field(self):
        doc = look()
        del doc["front_side"]
        self.assertInvalid(doc, "missing front_side")

    def test_a_wrong_schema_string(self):
        doc = look()
        doc["schema"] = "emberwalk.openart-look/2"
        self.assertInvalid(doc, "schema")

    def test_missing_credits(self):
        doc = look()
        del first(doc, "north")["credits"]
        self.assertInvalid(doc, "missing credits")

    def test_an_unknown_view(self):
        doc = look()
        first(doc, "north")["view"] = "south"
        self.assertInvalid(doc, "view")


class LookRefused(unittest.TestCase):
    def assertRefused(self, doc, words):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_look(doc)
        self.assertEqual(e.exception.kind, "refused")
        self.assertIn(words, str(e.exception))
        r, left = run(doc)
        self.assertEqual(r.returncode, 3)
        self.assertIn(words, r.stderr)
        self.assertEqual(r.stdout, "")
        self.assertEqual(left, [])

    def test_a_missing_synthetic_flag(self):
        doc = look()
        del doc["synthetic"]
        self.assertRefused(doc, "synthetic must be true")

    def test_a_false_synthetic_flag(self):
        doc = look()
        doc["synthetic"] = False
        self.assertRefused(doc, "synthetic must be true")

    def test_a_missing_label(self):
        doc = look()
        del doc["label"]
        self.assertRefused(doc, "label must be")

    def test_an_original_not_named_synthetic(self):
        doc = look()
        first(doc, "east")["original"]["file"] = "hero-east-1.png"
        self.assertRefused(doc, "hero-east-1.png does not start synthetic-")

    def test_a_copy_not_named_synthetic(self):
        doc = look()
        first(doc, "east")["copy"]["file"] = "east.jpg"
        self.assertRefused(doc, "east.jpg does not start synthetic-")

    def test_a_file_name_with_a_folder(self):
        doc = look()
        first(doc, "east")["original"]["file"] = "synthetic-x/../photo.png"
        self.assertRefused(doc, "a bare file name")

    def test_a_photo_reference(self):
        doc = look()
        first(doc, "front")["reference"] = {"kind": "photo"}
        self.assertRefused(doc, "reference photo")

    def test_a_link_reference(self):
        doc = look()
        first(doc, "front")["reference"] = {"kind": "https://example.com/house.jpg"}
        self.assertRefused(doc, "is not board, blender_frame, still or none")

    def test_a_blender_frame_with_no_frame(self):
        doc = look()
        del first(doc, "after_front")["reference"]["frame"]
        self.assertRefused(doc, "blender_frame needs its frame")

    def test_a_board_reference_with_a_frame(self):
        doc = look()
        first(doc, "front")["reference"]["frame"] = 3
        self.assertRefused(doc, "only a blender_frame has a frame")

    def test_a_chosen_still_with_no_pick_by_owner(self):
        doc = look()
        del first(doc, "front")["picked_by"]
        self.assertRefused(doc, "picked by owner")

    def test_a_chosen_still_picked_by_someone_else(self):
        doc = look()
        first(doc, "front")["picked_by"] = "manager"
        self.assertRefused(doc, "picked by owner")

    def test_a_chosen_still_with_no_date(self):
        doc = look()
        del first(doc, "front")["picked_on"]
        self.assertRefused(doc, "pick date")

    def test_a_chosen_still_with_a_bad_date(self):
        doc = look()
        first(doc, "front")["picked_on"] = "Oct 28"
        self.assertRefused(doc, "pick date")

    def test_a_chosen_still_with_no_copy(self):
        doc = look()
        del first(doc, "front")["copy"]
        self.assertRefused(doc, "committed copy")

    def test_a_copy_that_is_not_a_jpeg(self):
        doc = look()
        first(doc, "front")["copy"]["file"] = "synthetic-hero-front.png"
        self.assertRefused(doc, "JPEG")

    def test_a_copy_over_500_kb(self):
        doc = look()
        first(doc, "front")["copy"]["bytes"] = 500001
        self.assertRefused(doc, "500000 bytes")

    def test_a_copy_of_exactly_500_kb_passes(self):
        doc = look()
        first(doc, "front")["copy"]["bytes"] = 500000
        openart.validate_look(doc)

    def test_a_pick_on_a_still_not_chosen(self):
        doc = look()
        doc["stills"][1]["picked_by"] = "owner"
        self.assertRefused(doc, "not chosen")

    def test_two_chosen_stills_for_one_view(self):
        doc = look()
        second = doc["stills"][1]
        second.update(copy.deepcopy({k: doc["stills"][0][k] for k in ("chosen", "picked_by", "picked_on", "copy")}))
        self.assertRefused(doc, "two stills chosen for front")

    def test_a_view_missing(self):
        doc = look()
        doc["stills"] = [s for s in doc["stills"] if s["view"] != "west"]
        doc["credits_total"] = 90
        self.assertRefused(doc, "no still for west")

    def test_a_view_with_no_pick(self):
        doc = look()
        s = first(doc, "north")
        for k in ("chosen", "picked_by", "picked_on", "copy"):
            del s[k]
        self.assertRefused(doc, "no still picked for north")

    def test_chosen_false_is_not_a_pick(self):
        doc = look()
        first(doc, "north")["chosen"] = False
        self.assertRefused(doc, "not chosen")

    def test_a_short_sha256(self):
        doc = look()
        first(doc, "west")["original"]["sha256"] = HEX[:63]
        self.assertRefused(doc, "64 hex")

    def test_a_long_sha256(self):
        doc = look()
        first(doc, "west")["copy"]["sha256"] = HEX + "0"
        self.assertRefused(doc, "64 hex")

    def test_an_upper_case_sha256(self):
        doc = look()
        first(doc, "west")["original"]["sha256"] = HEX.upper()
        self.assertRefused(doc, "64 hex")

    def test_negative_credits(self):
        doc = look()
        first(doc, "north")["credits"] = -1
        doc["credits_total"] = 101.5
        self.assertRefused(doc, "credits below 0")

    def test_a_total_that_differs_from_the_sum(self):
        doc = look()
        doc["credits_total"] = 112
        self.assertRefused(doc, "credits_total 112 is not the sum of the stills' credits, 112.5")

    def test_one_original_listed_twice(self):
        doc = look()
        doc["stills"][3]["original"]["file"] = doc["stills"][0]["original"]["file"]
        self.assertRefused(doc, "original synthetic-hero-front-1.png listed twice")

    def test_one_original_sha256_listed_twice(self):
        doc = look()
        doc["stills"][3]["original"]["sha256"] = doc["stills"][0]["original"]["sha256"]
        self.assertRefused(doc, "same sha256 as still 1")

    def test_a_still_reference_not_in_the_file(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "still", "file": "synthetic-hero-front-9.png"}
        self.assertRefused(doc, "reference synthetic-hero-front-9.png is not a still in this file")

    def test_a_still_reference_to_itself(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "still", "file": "synthetic-hero-east-1.png"}
        self.assertRefused(doc, "a still cannot be its own reference")

    def test_a_still_reference_with_no_file(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "still"}
        self.assertRefused(doc, "reference still needs its file")

    def test_a_still_reference_with_a_frame(self):
        doc = look()
        first(doc, "east")["reference"] = {"kind": "still", "file": "synthetic-hero-front-2.png", "frame": 3}
        self.assertRefused(doc, "only a blender_frame has a frame")

    def test_a_board_reference_with_a_file(self):
        doc = look()
        first(doc, "front")["reference"]["file"] = "synthetic-hero-east-1.png"
        self.assertRefused(doc, "only a still reference has a file")


GLYPHS = [718, 826, 748, 852]


def blurred(box, glyphs=GLYPHS):
    doc = look()
    first(doc, "east")["blur"] = [{"glyphs": glyphs, "box": box}]
    return doc


class LookBlur(unittest.TestCase):
    assertRefused = LookRefused.assertRefused

    def test_d191_a_tight_blur_box_passes(self):
        openart.validate_look(blurred([710, 818, 756, 860]))

    def test_d191_a_box_equal_to_the_glyphs_passes(self):
        openart.validate_look(blurred(GLYPHS))

    def test_a_still_with_no_blur_passes(self):
        openart.validate_look(look())

    def test_d191_a_padded_blur_box_is_refused(self):
        w, h = 2752, 1536
        pad = [round(GLYPHS[0] - 0.02 * w), round(GLYPHS[1] - 0.02 * h), round(GLYPHS[2] + 0.02 * w), round(GLYPHS[3] + 0.02 * h)]
        self.assertRefused(blurred(pad), "margin of 55 px")

    def test_d191_a_margin_of_9_px_on_one_side_is_refused(self):
        self.assertRefused(blurred([709, 826, 748, 852]), "margin of 9 px on the left")

    def test_each_side_is_measured_on_its_own(self):
        for i, side in enumerate(("left", "top", "right", "bottom")):
            with self.subTest(side=side):
                box = list(GLYPHS)
                box[i] += -9 if i < 2 else 9
                self.assertRefused(blurred(box), "margin of 9 px on the %s" % side)

    def test_a_box_that_does_not_cover_the_glyphs_is_refused(self):
        self.assertRefused(blurred([720, 826, 748, 852]), "does not cover")

    def test_glyphs_with_no_area_are_refused(self):
        self.assertRefused(blurred([718, 826, 748, 852], glyphs=[718, 826, 718, 852]), "no area")

    def test_a_blur_box_of_the_wrong_shape_is_invalid(self):
        doc = blurred([710, 818, 756])
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_look(doc)
        self.assertEqual(e.exception.kind, "invalid")

    def test_a_blur_with_an_unknown_key_is_invalid(self):
        doc = blurred(GLYPHS)
        first(doc, "east")["blur"][0]["pad"] = 0.02
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_look(doc)
        self.assertEqual(e.exception.kind, "invalid")


def box_rows(frames, box=(100, 100, 200, 200), area=300):
    return [{"frame": f, "t": f / 15.0, "box_px": list(box), "area_px": area} for f in frames]


def truth():
    return {
        "schema": "emberwalk.truth/1",
        "scene": "hero-before",
        "hazards": [
            {"id": "wood-pile-1", "concept": "wood pile", "frame_boxes": box_rows(range(10, 51))},
            {"id": "gutter-leaves-front", "concept": "gutter leaves", "frame_boxes": box_rows(range(60, 81), area=250)},
            {"id": "fence-1", "concept": "fence", "frame_boxes": box_rows([15], area=150)},
        ],
    }


def sam_pass(checks=None, cost=1200000):
    return {
        "status": "pass",
        "cost_nano_usd": cost,
        "hazards": [{"id": "wood-pile-1", "concept": "wood pile", "checks": checks or [{"frame": 20, "box_px": [100, 100, 200, 200], "iou": 1.0}]}],
    }


def tried(start, end, sam, credits=30, frames=None, reference=None):
    return {
        "reference_frame": reference if reference is not None else (start + end) // 2,
        "creation_id": "cr-mix-1",
        "model": "kling-2",
        "credits": credits,
        "clip": {"file": "synthetic-hero-mix-1.mp4", "bytes": 5000000, "sha256": HEX, "frames": frames if frames is not None else end - start + 1},
        "sam_check": sam,
    }


def mix():
    return {
        "schema": "emberwalk.mix-list/1",
        "synthetic": True,
        "label": "Synthetic sample house",
        "scene": "hero-before",
        "frame_count": 100,
        "credits_total": 0,
        "sam_cost_total_nano_usd": 0,
        "chunks": [
            {"start": 1, "end": 50, "part": "loop", "source": "blender"},
            {"start": 51, "end": 100, "part": "pan-left", "source": "blender"},
        ],
    }


def with_clip(sam=None, credits=30, **over):
    doc = mix()
    first_chunk = doc["chunks"][0]
    first_chunk["source"] = "openart"
    first_chunk["openart"] = tried(1, 50, sam or sam_pass(), credits, **over)
    doc["credits_total"] = credits
    doc["sam_cost_total_nano_usd"] = (sam or sam_pass()).get("cost_nano_usd", 0)
    return doc


def attempt(sam, **over):
    doc = with_clip(sam, **over)
    doc["chunks"][0]["source"] = "blender"
    return doc


class MixNormal(unittest.TestCase):
    def test_an_all_blender_list_passes(self):
        openart.validate_mix(mix(), truth())

    def test_an_openart_chunk_with_a_pass_that_finds_every_visible_hazard_passes(self):
        openart.validate_mix(with_clip(), truth())

    def test_a_chunk_tried_in_openart_and_not_checked_stays_blender(self):
        doc = attempt({"status": "not_run"})
        openart.validate_mix(doc, truth())

    def test_a_clip_one_frame_off_its_chunk_passes(self):
        openart.validate_mix(with_clip(frames=51), truth())

    def test_the_summary_counts_chunks_credits_and_sam_cost(self):
        text = openart.mix_summary(with_clip())
        self.assertIn("hero-before: 2 chunks covering 100 frames, 1 from OpenArt, 30 credits, 1200000 nano USD", text)


class MixInvalid(unittest.TestCase):
    def kind(self, doc):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_mix(doc, truth())
        return e.exception.kind

    def test_a_list_that_is_not_an_object_is_invalid(self):
        self.assertEqual(self.kind([]), "invalid")

    def test_a_missing_field_is_invalid(self):
        for drop in ("frame_count", "chunks", "credits_total", "scene"):
            doc = mix()
            del doc[drop]
            self.assertEqual(self.kind(doc), "invalid", drop)
        doc = mix()
        del doc["chunks"][0]["part"]
        self.assertEqual(self.kind(doc), "invalid")

    def test_a_wrong_schema_string_is_invalid(self):
        doc = mix()
        doc["schema"] = "emberwalk.mix-list/2"
        self.assertEqual(self.kind(doc), "invalid")

    def test_an_unknown_source_or_key_is_invalid(self):
        doc = mix()
        doc["chunks"][0]["source"] = "sora"
        self.assertEqual(self.kind(doc), "invalid")
        doc = mix()
        doc["chunks"][0]["extra"] = 1
        self.assertEqual(self.kind(doc), "invalid")

    def test_a_truth_file_without_hazards_is_invalid(self):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_mix(mix(), {"scene": "hero-before"})
        self.assertEqual(e.exception.kind, "invalid")

    def test_malformed_json_exits_3_through_the_command(self):
        r, left = run_mix("{not json", truth())
        self.assertEqual(r.returncode, 3)
        self.assertIn("EW_ERROR", r.stderr)
        self.assertEqual(left, [])


class MixRefused(unittest.TestCase):
    def refused(self, doc, words, tr=None):
        with self.assertRaises(openart.OpenArtError) as e:
            openart.validate_mix(doc, tr or truth())
        self.assertEqual(e.exception.kind, "refused")
        self.assertIn(words, str(e.exception))

    def test_a_gap_is_refused(self):
        doc = mix()
        doc["chunks"][1]["start"] = 53
        self.refused(doc, "gap")

    def test_an_overlap_is_refused(self):
        doc = mix()
        doc["chunks"][1]["start"] = 50
        self.refused(doc, "overlap")

    def test_a_list_that_does_not_start_at_frame_1_or_end_at_the_last_is_refused(self):
        doc = mix()
        doc["chunks"][0]["start"] = 2
        self.refused(doc, "starts at frame 2")
        doc = mix()
        doc["chunks"][1]["end"] = 99
        self.refused(doc, "ends at frame 99")

    def test_a_chunk_outside_the_walk_or_ending_before_it_starts_is_refused(self):
        doc = mix()
        doc["chunks"][1]["end"] = 101
        self.refused(doc, "outside the 100 frame walk")
        doc = mix()
        doc["chunks"][1]["end"] = 40
        self.refused(doc, "ends before it starts")

    def test_a_walk_shorter_than_the_truth_boxes_is_refused(self):
        doc = mix()
        doc["frame_count"] = 70
        doc["chunks"][1]["end"] = 70
        self.refused(doc, "truth shows a box on frame 80")

    def test_an_openart_chunk_whose_check_did_not_pass_is_refused(self):
        for status in ("not_run", "fail"):
            doc = with_clip({"status": status, "cost_nano_usd": 5})
            self.refused(doc, "check is %s" % status)

    def test_an_openart_chunk_with_no_clip_record_is_refused(self):
        doc = mix()
        doc["chunks"][0]["source"] = "openart"
        self.refused(doc, "no OpenArt record")

    def test_an_openart_chunk_with_no_sam_cost_is_refused(self):
        sam = sam_pass()
        del sam["cost_nano_usd"]
        self.refused(with_clip(sam), "no SAM cost")

    def test_a_pass_that_misses_a_visible_hazard_is_refused(self):
        sam = sam_pass()
        sam["hazards"] = []
        self.refused(with_clip(sam), "wood-pile-1")

    def test_a_pass_that_checks_no_frame_of_a_visible_hazard_is_refused(self):
        sam = sam_pass()
        sam["hazards"][0]["checks"] = []
        self.refused(with_clip(sam), "wood-pile-1")

    def test_an_overlap_under_half_on_a_checked_frame_is_refused(self):
        sam = sam_pass([{"frame": 20, "box_px": [100, 100, 200, 200], "iou": 1.0}, {"frame": 21, "box_px": [100, 100, 150, 200], "iou": 0.5}])
        openart.validate_mix(with_clip(sam), truth())
        sam = sam_pass([{"frame": 20, "box_px": [100, 100, 140, 200], "iou": 0.4}])
        self.refused(with_clip(sam), "overlap 0.4")

    def test_a_recorded_overlap_that_the_boxes_do_not_give_is_refused(self):
        sam = sam_pass([{"frame": 20, "box_px": [100, 100, 140, 200], "iou": 0.9}])
        self.refused(with_clip(sam), "boxes give")

    def test_a_checked_frame_outside_the_chunk_or_with_no_truth_box_is_refused(self):
        sam = sam_pass([{"frame": 20, "box_px": [100, 100, 200, 200], "iou": 1.0}, {"frame": 70, "box_px": [100, 100, 200, 200], "iou": 1.0}])
        self.refused(with_clip(sam), "frame 70")
        sam = sam_pass([{"frame": 5, "box_px": [100, 100, 200, 200], "iou": 1.0}])
        self.refused(with_clip(sam), "frame 5")

    def test_a_reference_frame_outside_its_chunk_is_refused(self):
        self.refused(with_clip(reference=51), "reference frame 51")

    def test_a_clip_length_more_than_one_frame_off_is_refused(self):
        self.refused(with_clip(frames=52), "clip is 52 frames")
        self.refused(with_clip(frames=48), "clip is 48 frames")

    def test_a_clip_file_name_not_starting_synthetic_is_refused(self):
        doc = with_clip()
        doc["chunks"][0]["openart"]["clip"]["file"] = "hero-mix-1.mp4"
        self.refused(doc, "does not start synthetic-")

    def test_a_missing_synthetic_flag_or_label_is_refused(self):
        doc = mix()
        doc["synthetic"] = False
        self.refused(doc, "synthetic must be true")
        doc = mix()
        doc["label"] = "A house"
        self.refused(doc, "label must be")

    def test_totals_that_are_not_the_sums_are_refused(self):
        doc = with_clip()
        doc["credits_total"] = 31
        self.refused(doc, "credits_total 31")
        doc = with_clip()
        doc["sam_cost_total_nano_usd"] = 1
        self.refused(doc, "sam_cost_total_nano_usd 1")


def run_mix(mix_doc, truth_doc, look_doc=None, extra=()):
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "work")
        os.makedirs(work)
        args = [sys.executable, CHECK]
        for flag, doc in (("--mix", mix_doc), ("--truth", truth_doc), ("--look", look_doc)):
            if doc is None:
                continue
            path = os.path.join(tmp, flag[2:] + ".json")
            with open(path, "w", encoding="utf-8") as f:
                f.write(doc if isinstance(doc, str) else json.dumps(doc))
            args += [flag, path]
        r = subprocess.run(args + list(extra), cwd=work, capture_output=True, text=True)
        return r, sorted(os.listdir(work))


class MixCli(unittest.TestCase):
    def test_a_good_list_prints_its_credit_and_sam_totals_and_exits_0(self):
        r, left = run_mix(with_clip(), truth())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("30 credits, 1200000 nano USD", r.stdout)
        self.assertEqual(left, [])

    def test_mix_with_look_prints_a_total_equal_to_the_sum_of_both(self):
        r, _ = run_mix(with_clip(), truth(), look())
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("total 142.5 credits (look 112.5, mix 30)", r.stdout)
        self.assertIn("112.5 credits", r.stdout)

    def test_a_refused_list_exits_3_with_the_reason(self):
        doc = mix()
        doc["chunks"][1]["start"] = 53
        r, _ = run_mix(doc, truth())
        self.assertEqual(r.returncode, 3)
        self.assertIn("gap", r.stderr)

    def test_mix_without_truth_exits_3(self):
        r, _ = run_mix(mix(), None)
        self.assertEqual(r.returncode, 3)
        self.assertIn("--truth", r.stderr)

    def test_the_committed_hero_before_list_covers_the_spec_walk_part_by_part(self):
        root = os.path.join(support.BLENDER_DIR, "..", "fixtures", "synthetic", "hero-before")
        listed = openart.load_json(os.path.join(root, "mix.json"))
        _, parts = route.build(openart.load_json(os.path.join(root, "spec.json")))
        self.assertEqual(listed["frame_count"], parts["frame_count"])
        self.assertEqual([(c["start"], c["end"]) for c in listed["chunks"]], [(p["start_frame"], p["end_frame"]) for p in parts["parts"]])
        self.assertEqual({c["source"] for c in listed["chunks"]}, {"blender"})
        in_walk = {"hazards": [{"id": "h", "concept": "c", "frame_boxes": box_rows([1, parts["frame_count"]])}]}
        openart.validate_mix(listed, in_walk)


class Cli(unittest.TestCase):
    def test_no_look_argument_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as work:
            r = subprocess.run([sys.executable, CHECK], cwd=work, capture_output=True, text=True)
            self.assertEqual(r.returncode, 2)
            self.assertIn("--look", r.stderr)
            self.assertEqual(os.listdir(work), [])

    def test_importing_the_cli_runs_nothing_and_main_returns_its_code(self):
        spec = importlib.util.spec_from_file_location("check_openart_under_test", CHECK)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "look.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(look(), f)
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(module.main(["--look", path]), 0)
            self.assertIn("112.5 credits", out.getvalue())


class CreditSum(unittest.TestCase):
    def test_fractions_add_without_float_drift(self):
        self.assertEqual(openart.credit_sum([0.1, 0.2, 0.3]), 0.6)

    def test_an_empty_list_is_zero(self):
        self.assertEqual(openart.credit_sum([]), 0)


if __name__ == "__main__":
    unittest.main()
