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
from ewscene import openart

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
