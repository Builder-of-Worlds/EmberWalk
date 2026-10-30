import copy
import json
import math
import os
import subprocess
import tempfile
import unittest

import support
from ewscene import house

APARTMENT = os.path.join(support.REPO_DIR, "fixtures", "synthetic", "apartment-before", "spec.json")
BUILD_HOUSE = os.path.join(support.BLENDER_DIR, "build_house.py")
DUMP = os.path.join(support.BLENDER_DIR, "tests", "dump_house.py")
BLENDER = support.blender_path()


def spec():
    return copy.deepcopy(support.load_json(APARTMENT))


def carriers():
    return [t for t in spec()["trees"] if t["branches"]]


def other_cap(island, cap):
    return next(c for c in island["caps"] if c is not cap)


def trees_of(form):
    return [t for t in spec()["trees"] if house.tree_form(t) == form]


ROOT_PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_branch_root.py")


@unittest.skipUnless(BLENDER, "Blender not found: the branch root probe did not run, so this is a PARTIAL RUN")
class BranchRoot(unittest.TestCase):
    def test_a_limb_meets_a_branch_off_a_far_wall_at_the_branch_root(self):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", ROOT_PROBE],
                             capture_output=True, text=True, timeout=300)
        self.assertEqual(run.returncode, 0, run.stderr[-600:])
        root = json.loads(next(l for l in run.stdout.splitlines() if l.startswith("EW_ROOT "))[8:])
        for got, want in zip(root, (1068, 120, 245)):
            self.assertAlmostEqual(got, want, delta=0.5)


LAYOUT_PROBE = os.path.join(support.BLENDER_DIR, "tests", "probe_tree_layout.py")


def circle_gap(a, b):
    d = (a - b) % (2 * math.pi)
    return min(d, 2 * math.pi - d)


@unittest.skipUnless(BLENDER, "Blender not found: the tree layout probe did not run, so this is a PARTIAL RUN")
class TreeLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", LAYOUT_PROBE],
                             capture_output=True, text=True, timeout=300)
        cls.err = run.stderr[-600:]
        line = next((l for l in run.stdout.splitlines() if l.startswith("EW_LAYOUT ")), None)
        cls.layout = json.loads(line[10:]) if line else None

    def setUp(self):
        self.assertTrue(self.layout, self.err)

    def test_each_conifer_tier_lays_its_limbs_round_from_its_own_turn(self):
        tiers = {}
        for z, ang in self.layout["limbs"]:
            tiers.setdefault(round(z, 3), []).append(ang)
        self.assertGreaterEqual(len(tiers), 5)
        turn, nudge = self.layout["turn_draw"] * 2 * math.pi, -0.2 + self.layout["turn_draw"] * 0.4
        for z, got in tiers.items():
            for j in range(len(got)):
                want = turn + (j + nudge) * 2 * math.pi / len(got)
                self.assertLess(min(circle_gap(want, a) for a in got), 1e-6, "tier at %.0f in has no limb at %.3f" % (z, want))

    def test_an_oak_trunk_sinks_two_inches_into_its_root_flare(self):
        for oak in self.layout["oaks"]:
            (flare_lo, flare_hi, _, _, flare_sides), (trunk_lo, _, _, _, trunk_sides) = oak["rods"]
            self.assertEqual(trunk_sides, flare_sides, "the trunk and its flare do not meet side to side")
            self.assertEqual(trunk_lo[:2], [0, 0])
            self.assertEqual(flare_lo[:2], flare_hi[:2])
            self.assertLessEqual(trunk_lo[2], flare_hi[2] - 2.0)
            self.assertGreaterEqual(trunk_lo[2], flare_lo[2])

    def test_every_oak_leaf_clump_is_a_fifth_to_a_third_of_its_reach(self):
        for oak in self.layout["oaks"]:
            reach = oak["reach_in"]
            self.assertGreaterEqual(len(oak["clumps"]), 40)
            self.assertGreaterEqual(min(oak["clumps"]), reach * 0.2 - 1e-9)
            self.assertLessEqual(max(oak["clumps"]), reach * 0.33 + 1e-9)


def build(path, out):
    return subprocess.run(
        [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", "--python", BUILD_HOUSE, "--", path, "--out", out],
        capture_output=True, text=True, timeout=1200,
    )


def write(folder, doc):
    path = os.path.join(folder, "doc.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return path


class TreeForms(unittest.TestCase):
    def test_a_tall_narrow_tree_is_a_conifer_and_a_broad_one_an_oak(self):
        self.assertEqual(house.tree_form({"height_in": 600, "canopy_in": 300}), "conifer")
        self.assertEqual(house.tree_form({"height_in": 480, "canopy_in": 300}), "oak")

    def test_a_tree_exactly_one_point_nine_times_as_tall_as_wide_is_a_conifer(self):
        self.assertEqual(house.tree_form({"height_in": 570, "canopy_in": 300}), "conifer")
        self.assertEqual(house.tree_form({"height_in": 569, "canopy_in": 300}), "oak")

    def test_the_apartment_lot_holds_both_forms(self):
        forms = {house.tree_form(t) for t in spec()["trees"]}
        self.assertEqual(forms, {"conifer", "oak"})


@unittest.skipUnless(BLENDER, "Blender not found: the tree build gap test did not run, so this is a PARTIAL RUN")
class TreesInTheScene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = os.path.join(cls.tmp.name, "out")
        cls.built = build(APARTMENT, cls.out)
        cls.record = support.load_json(os.path.join(cls.out, "scene.json")) if cls.built.returncode == 0 else {}
        cls.dumped = {}
        if cls.built.returncode == 0:
            dumped = os.path.join(cls.tmp.name, "dumped.json")
            argv = [BLENDER, "--background", "--factory-startup", "--python-exit-code", "1", os.path.join(cls.out, "scene.blend"),
                    "--python", DUMP, "--", "--out", dumped]
            for t in spec()["trees"]:
                argv += ["--detail", t["id"]] + [x for b in t["branches"] for x in ("--verts", b)]
            if subprocess.run(argv, capture_output=True, text=True, timeout=1200).returncode == 0:
                cls.dumped = support.load_json(dumped)["objects"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_apartment_images_with_more_trees(self):
        """apartment images have more trees, since Northern California is heavily wooded"""
        self.assertEqual(self.built.returncode, 0, self.built.stderr[-600:])
        self.assertTrue(os.path.exists(os.path.join(self.out, "scene.blend")))
        self.assertEqual([t["id"] for t in self.record["trees"]], [t["id"] for t in spec()["trees"]])

    def test_every_tree_stands_at_its_place_and_size(self):
        for built, want in zip(self.record["trees"], spec()["trees"]):
            lo, hi = built["min_in"], built["max_in"]
            self.assertAlmostEqual(lo[2], 0, delta=1.0, msg=want["id"])
            self.assertAlmostEqual(hi[2], want["height_in"], delta=want["height_in"] * 0.01, msg=want["id"])
            for axis in (0, 1):
                self.assertAlmostEqual((lo[axis] + hi[axis]) / 2.0, want["at_in"][axis], delta=want["canopy_in"] * 0.15, msg=want["id"])
                self.assertLessEqual(hi[axis] - lo[axis], want["canopy_in"] + (60.0 if want["branches"] else 10.0), want["id"])
                self.assertGreaterEqual(hi[axis] - lo[axis], want["canopy_in"] * 0.6, want["id"])

    def test_each_branch_over_the_roof_grows_from_its_tree_on_a_limb(self):
        doc = spec()
        self.assertTrue(self.dumped, "the built scene could not be dumped")
        by_side = {e["side"]: e for e in house.edges(doc)}
        hazards = {h["id"]: h for h in doc["hazards"]}
        for t in carriers():
            islands = self.dumped[t["id"]]["islands"]
            caps = [(c, i) for i, island in enumerate(islands) for c in island["caps"]]
            for b in t["branches"]:
                verts = self.dumped[b]["verts"]
                (sx, sy), (nx, ny) = by_side[hazards[b]["side"]]["start"], by_side[hazards[b]["side"]]["n"]
                out = lambda p: (p[0] - sx) * nx + (p[1] - sy) * ny
                gap = lambda c: min(math.dist(c["centre"], q) for q in verts)
                end, at = min(caps, key=lambda ci: gap(ci[0]))
                self.assertLessEqual(gap(end), 6.0, "%s: the limb does not touch %s" % (t["id"], b))
                self.assertGreaterEqual(out(end["centre"]), max(out(p) for p in verts) - 6.0, "%s: the limb meets %s short of its root" % (t["id"], b))
                mid = other_cap(islands[at], end)
                joined = [(c, i) for c, i in caps if i != at and math.dist(c["centre"], mid["centre"]) < 1.0]
                self.assertEqual(len(joined), 1, "%s: the limb to %s is not one bent piece" % (t["id"], b))
                start = other_cap(islands[joined[0][1]], joined[0][0])["centre"]
                self.assertLessEqual(math.dist(start[:2], t["at_in"]), t["trunk_in"] / 2.0, "%s: the limb to %s leaves the trunk" % (t["id"], b))
                self.assertTrue(36.0 <= start[2] <= t["height_in"], "%s: the limb to %s starts at %.1f in" % (t["id"], b, start[2]))

    def caps(self, t):
        return [c for island in self.dumped[t["id"]]["islands"] for c in island["caps"]]

    def test_each_oak_forks_into_four_or_five_limbs(self):
        self.assertTrue(self.dumped, "the built scene could not be dumped")
        for t in trees_of("oak"):
            pieces = len(self.dumped[t["id"]]["islands"]) - 2 - 2 * len(t["branches"])
            self.assertIn(pieces, (16, 20), "%s: %d limb pieces past the trunk" % (t["id"], pieces))

    def test_conifer_trunks_lean_no_one_way(self):
        self.assertTrue(self.dumped, "the built scene could not be dumped")
        leans = []
        for t in trees_of("conifer"):
            top = max(self.caps(t), key=lambda c: c["centre"][2])["centre"]
            self.assertAlmostEqual(top[2], t["height_in"], delta=1.0, msg=t["id"])
            leans.append([top[0] - t["at_in"][0], top[1] - t["at_in"][1]])
            self.assertLessEqual(math.hypot(*leans[-1]), t["trunk_in"] * 0.15, t["id"])
        for axis in (0, 1):
            self.assertLess(min(l[axis] for l in leans), 0.0, "every conifer leans the same way on axis %d" % axis)
            self.assertGreater(max(l[axis] for l in leans), 0.0, "every conifer leans the same way on axis %d" % axis)

    def test_each_conifer_tier_spreads_its_limbs_all_round(self):
        self.assertTrue(self.dumped, "the built scene could not be dumped")
        for t in trees_of("conifer"):
            tiers = {}
            for c in self.caps(t):
                dx, dy = c["centre"][0] - t["at_in"][0], c["centre"][1] - t["at_in"][1]
                if abs(c["radius_in"] - 1.2) < 0.05 and abs(math.hypot(dx, dy) - 2.0) < 0.05:
                    tiers.setdefault(round(c["centre"][2], 1), []).append(math.atan2(dy, dx))
            self.assertGreaterEqual(len(tiers), 5, t["id"])
            for z, angles in tiers.items():
                angles.sort()
                gaps = [b - a for a, b in zip(angles, angles[1:])] + [angles[0] + 2 * math.pi - angles[-1]]
                self.assertLessEqual(max(gaps), 1.45 * 2 * math.pi / len(angles), "%s: the tier at %.1f in leaves a side bare" % (t["id"], z))

    def test_a_branch_a_tree_carries_gets_no_separate_support(self):
        self.assertTrue(self.dumped, "the built scene could not be dumped")
        for t in carriers():
            for b in t["branches"]:
                self.assertTrue(b in self.dumped, "%s was not built" % b)
                self.assertFalse("Branch support " + b in self.dumped, "%s also has a separate support" % b)

    def test_each_tree_is_built_in_the_form_its_proportions_give(self):
        for built, want in zip(self.record["trees"], spec()["trees"]):
            self.assertEqual(built["form"], house.tree_form(want), want["id"])


@unittest.skipUnless(BLENDER, "Blender not found: the tree build refusals did not run, so this is a PARTIAL RUN")
class TreesRefused(unittest.TestCase):
    def assertRefusedBuild(self, doc, words):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            run = build(write(tmp, doc), out)
            self.assertEqual(run.returncode, 3, run.stdout[-600:] + run.stderr[-600:])
            self.assertIn(words, run.stderr)
            self.assertFalse(os.path.exists(out))

    def tree(self, doc):
        return next(t for t in doc["trees"] if t["id"] == "tree-back-west")

    def test_a_tree_standing_in_the_walk_is_refused(self):
        doc = spec()
        self.tree(doc).update(at_in=[100, -130], canopy_in=24)
        self.assertRefusedBuild(doc, "tree-back-west: its trunk is in the walk")

    def test_a_canopy_narrower_than_its_trunk_is_refused(self):
        doc = spec()
        self.tree(doc)["canopy_in"] = 20
        self.assertRefusedBuild(doc, "its canopy is narrower than its trunk")

    def test_a_tree_asset_that_is_not_a_tree_is_refused(self):
        doc = spec()
        self.tree(doc)["asset"] = "scripted:wood_pile"
        self.assertRefusedBuild(doc, "scripted:wood_pile is not a tree")


class TreesInvalid(unittest.TestCase):
    def assertInvalid(self, doc):
        with self.assertRaises(house.HouseError) as ctx:
            house.validate(doc, support_catalog(), house.load_rules())
        self.assertEqual(ctx.exception.kind, "invalid")

    def test_a_tree_with_no_trunk_is_invalid(self):
        doc = spec()
        del doc["trees"][0]["trunk_in"]
        self.assertInvalid(doc)

    def test_a_tree_under_ten_feet_is_invalid(self):
        doc = spec()
        doc["trees"][0]["height_in"] = 100
        self.assertInvalid(doc)


def support_catalog():
    from ewscene import assets
    return assets.load_catalog()


if __name__ == "__main__":
    unittest.main()
