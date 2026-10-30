import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import arrival

CHECK = os.path.join(support.BLENDER_DIR, "check_arrival.py")
BEFORE_VIDEO = b"pretend walk video bytes"
STILL = b"pretend still bytes"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def put(root, rel, data):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def render_doc(data=BEFORE_VIDEO):
    return {"schema": "emberwalk.render/1", "scene": "hero-before", "file": "hero-before/synthetic-hero-before-walk.mp4",
            "size_bytes": len(data), "sha256": sha(data)}


def look_doc(data=STILL):
    return {"schema": "emberwalk.openart-look/1", "scene": "hero-look", "stills": [
        {"view": "front", "original": {"file": "synthetic-hero-front-2.png", "bytes": len(data), "sha256": sha(data)}}]}


def recheck_doc(data=STILL):
    return {"schema": "emberwalk.recheck/1", "scene": "hero-after", "stills": [
        {"hazard_id": "wood-pile-wall", "file": "synthetic-recheck-wood-pile-wall.png", "sha256": sha(data)}]}


def look_doc_with(change):
    doc = look_doc()
    change(doc["stills"][0])
    return doc


def recheck_doc_with(change):
    doc = recheck_doc()
    change(doc["stills"][0])
    return doc


def moved(root):
    put(root, "hero-before/synthetic-hero-before-walk.mp4", BEFORE_VIDEO)
    put(root, "hero-look/synthetic-hero-front-2.png", STILL)
    put(root, "hero-after/recheck/synthetic-recheck-wood-pile-wall.png", STILL)


def run(doc, root):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "manifest.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(doc if isinstance(doc, str) else json.dumps(doc))
        return subprocess.run([sys.executable, CHECK, path, "--renders", root], capture_output=True, text=True)


class Entries(unittest.TestCase):
    def test_a_render_record_names_its_video_size_and_hash(self):
        self.assertEqual(arrival.entries(render_doc()), [("hero-before/synthetic-hero-before-walk.mp4", len(BEFORE_VIDEO), sha(BEFORE_VIDEO))])

    def test_a_look_file_names_each_original_in_its_scene_folder(self):
        self.assertEqual(arrival.entries(look_doc()), [("hero-look/synthetic-hero-front-2.png", len(STILL), sha(STILL))])

    def test_a_recheck_file_names_each_still_in_the_recheck_folder_of_its_scene(self):
        self.assertEqual(arrival.entries(recheck_doc()), [("hero-after/recheck/synthetic-recheck-wood-pile-wall.png", None, sha(STILL))])

    def test_an_unknown_schema_is_invalid(self):
        with self.assertRaises(arrival.ArrivalError) as e:
            arrival.entries({"schema": "emberwalk.truth/1"})
        self.assertEqual(e.exception.kind, "invalid")

    def test_not_an_object_is_invalid(self):
        with self.assertRaises(arrival.ArrivalError) as e:
            arrival.entries([1])
        self.assertEqual(e.exception.kind, "invalid")

    def test_a_missing_field_is_invalid(self):
        doc = render_doc()
        del doc["sha256"]
        with self.assertRaises(arrival.ArrivalError) as e:
            arrival.entries(doc)
        self.assertEqual(e.exception.kind, "invalid")

    def test_a_still_missing_a_field_is_invalid_not_a_key_error(self):
        lacking = {
            "look without original": look_doc_with(lambda s: s.pop("original")),
            "look without file": look_doc_with(lambda s: s["original"].pop("file")),
            "look without bytes": look_doc_with(lambda s: s["original"].pop("bytes")),
            "look without sha256": look_doc_with(lambda s: s["original"].pop("sha256")),
            "look original not an object": look_doc_with(lambda s: s.update(original="x")),
            "recheck without file": recheck_doc_with(lambda s: s.pop("file")),
            "recheck without sha256": recheck_doc_with(lambda s: s.pop("sha256")),
            "stills not a list": dict(look_doc(), stills="x"),
            "a still not an object": dict(look_doc(), stills=["x"]),
        }
        for name, doc in lacking.items():
            with self.subTest(name):
                with self.assertRaises(arrival.ArrivalError) as e:
                    arrival.entries(doc)
                self.assertEqual(e.exception.kind, "invalid")

    def test_a_name_that_leaves_the_renders_folder_is_refused(self):
        for bad in ("../x.mp4", "/etc/passwd", "hero-before/../../x.mp4"):
            with self.subTest(bad=bad):
                doc = dict(render_doc(), file=bad)
                with self.assertRaises(arrival.ArrivalError) as e:
                    arrival.entries(doc)
                self.assertEqual(e.exception.kind, "refused")


class Verify(unittest.TestCase):
    def test_every_moved_file_that_matches_passes(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            for doc in (render_doc(), look_doc(), recheck_doc()):
                self.assertEqual(arrival.problems(arrival.entries(doc), root), [])

    def test_a_missing_file_is_a_problem(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIn("missing", arrival.problems(arrival.entries(render_doc()), root)[0])

    def test_a_file_of_the_wrong_size_is_a_problem(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            put(root, "hero-before/synthetic-hero-before-walk.mp4", BEFORE_VIDEO + b"x")
            found = arrival.problems(arrival.entries(render_doc()), root)
            self.assertEqual(len(found), 1)
            self.assertIn("%d bytes, the record says %d" % (len(BEFORE_VIDEO) + 1, len(BEFORE_VIDEO)), found[0])

    def test_a_file_with_the_right_size_and_other_bytes_is_a_problem(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            put(root, "hero-before/synthetic-hero-before-walk.mp4", b"x" * len(BEFORE_VIDEO))
            found = arrival.problems(arrival.entries(render_doc()), root)
            self.assertEqual(len(found), 1)
            self.assertIn("sha256", found[0])

    def test_a_recheck_still_has_no_size_and_is_judged_by_its_hash(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            put(root, "hero-after/recheck/synthetic-recheck-wood-pile-wall.png", b"other")
            self.assertIn("sha256", arrival.problems(arrival.entries(recheck_doc()), root)[0])

    def test_each_bad_file_is_named(self):
        with tempfile.TemporaryDirectory() as root:
            doc = look_doc()
            doc["stills"].append({"view": "east", "original": {"file": "synthetic-hero-east-1.png", "bytes": 3, "sha256": sha(b"abc")}})
            put(root, "hero-look/synthetic-hero-front-2.png", b"bad")
            found = arrival.problems(arrival.entries(doc), root)
            self.assertEqual(len(found), 2)
            self.assertIn("synthetic-hero-front-2.png", found[0])
            self.assertIn("synthetic-hero-east-1.png", found[1])


class Cli(unittest.TestCase):
    def test_matching_files_exit_0_with_one_line(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            r = run(render_doc(), root)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(len(r.stdout.strip().splitlines()), 1)
            self.assertIn("1 file", r.stdout)

    def test_a_changed_file_exits_3_and_names_it(self):
        with tempfile.TemporaryDirectory() as root:
            moved(root)
            put(root, "hero-after/recheck/synthetic-recheck-wood-pile-wall.png", b"torn")
            r = run(recheck_doc(), root)
            self.assertEqual(r.returncode, 3)
            self.assertIn("synthetic-recheck-wood-pile-wall.png", r.stderr)
            self.assertEqual(r.stdout, "")

    def test_malformed_json_exits_3(self):
        with tempfile.TemporaryDirectory() as root:
            r = run("{ not json", root)
            self.assertEqual(r.returncode, 3)
            self.assertIn("arrival invalid", r.stderr)

    def test_a_look_still_with_no_original_exits_3_not_1(self):
        with tempfile.TemporaryDirectory() as root:
            r = run(look_doc_with(lambda s: s.pop("original")), root)
            self.assertEqual(r.returncode, 3, r.stderr)
            self.assertIn("arrival invalid: missing original", r.stderr)

    def test_a_render_record_whose_file_is_not_a_name_exits_3_not_1(self):
        for bad in (5, None, ["a.mp4"]):
            with self.subTest(bad=bad):
                with tempfile.TemporaryDirectory() as root:
                    r = run(dict(render_doc(), file=bad), root)
                    self.assertEqual(r.returncode, 3, r.stderr)
                    self.assertIn("arrival invalid: file is not a name", r.stderr)

    def test_a_still_missing_a_field_exits_3_for_every_schema(self):
        cases = {
            "look without original file": look_doc_with(lambda s: s["original"].pop("file")),
            "recheck without sha256": recheck_doc_with(lambda s: s.pop("sha256")),
            "render without size_bytes": {k: v for k, v in render_doc().items() if k != "size_bytes"},
        }
        for name, doc in cases.items():
            with self.subTest(name):
                with tempfile.TemporaryDirectory() as root:
                    r = run(doc, root)
                    self.assertEqual(r.returncode, 3, r.stderr)
                    self.assertIn("arrival invalid: missing", r.stderr)

    def test_the_committed_look_file_is_read_in_the_same_way(self):
        doc = support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-look", "look.json"))
        got = arrival.entries(doc)
        self.assertEqual(len(got), 14)
        self.assertTrue(all(name.startswith("hero-look/synthetic-hero-") and size > 0 and len(digest) == 64 for name, size, digest in got))


if __name__ == "__main__":
    unittest.main()
