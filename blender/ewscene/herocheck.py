import json
import os

from ewscene import assets, house, maskbox, probe, route

BEFORE, AFTER = "hero-before", "hero-after"
SCENE_FILES = ("truth.json", "motion.json", "parts.json", "render.json")
CATALOG = assets.load_catalog()
RULES = house.load_rules()


def findings(doc):
    return doc["hazards"] + doc.get("structure_hazards", [])


def spec_problems(spec, doc):
    out = []
    have = {h["id"]: h for h in doc["hazards"]}
    want = {h["id"]: h for h in spec["hazards"]}
    if set(have) != set(want):
        out.append("truth hazards differ from the spec's: missing %s, extra %s" % (sorted(set(want) - set(have)), sorted(set(have) - set(want))))
    for hazard_id in sorted(set(have) & set(want)):
        for key in ("band", "side", "rule_id"):
            if key not in have[hazard_id]:
                out.append("%s has no %s" % (hazard_id, key))
            elif have[hazard_id][key] != want[hazard_id][key]:
                out.append("%s: %s is %s, the spec says %s" % (hazard_id, key, have[hazard_id][key], want[hazard_id][key]))
    try:
        house.validate(doc, CATALOG, RULES)
    except house.HouseError as e:
        out.append("the house check refuses the truth: %s" % e)
    return out


def box_problems(doc, walk):
    out = []
    width, height = walk["camera"]["width_px"], walk["camera"]["height_px"]
    for h in findings(doc):
        for row in h.get("frame_boxes", []):
            where = "%s frame %s" % (h["id"], row.get("frame"))
            frame = row.get("frame")
            if not isinstance(frame, int) or isinstance(frame, bool) or not 1 <= frame <= walk["frame_count"]:
                out.append("%s: not a frame of the %d frame walk" % (where, walk["frame_count"]))
                continue
            left, top, right, bottom = row["box_px"]
            if not (0 <= left < right <= width and 0 <= top < bottom <= height):
                out.append("%s: box %s is outside the %dx%d image" % (where, row["box_px"], width, height))
            if row["area_px"] < maskbox.MIN_MASK_PX:
                out.append("%s: %d mask pixels, under %d" % (where, row["area_px"], maskbox.MIN_MASK_PX))
    return out


def seen(h):
    return any(row["area_px"] >= maskbox.MIN_MASK_PX for row in h.get("frame_boxes", []))


def visibility_problems(doc):
    out = []
    near = sum(1 for h in doc["hazards"] if h.get("band") == "0_5" and seen(h))
    if near < 2:
        out.append("%d hazards in 0_5 are visible on the walk, two are needed" % near)
    if not any(h.get("band") == "30_100" and seen(h) for h in doc["hazards"]):
        out.append("no hazard in 30_100 is visible on the walk")
    return out


def render_problems(doc, walk, record):
    out = ["%s names scene %s, the walk names %s" % (name, got, walk["scene"])
           for name, got in (("truth", doc["scene"]), ("render.json", record["scene"])) if got != walk["scene"]]
    return out + probe.problems(record, walk)


def truth_problems(spec, doc, walk, record):
    demo = visibility_problems(doc) if doc["state"] == "before" else []
    return spec_problems(spec, doc) + box_problems(doc, walk) + demo + render_problems(doc, walk, record)


def route_problems(before_walk, before_parts, after_walk, after_parts):
    out = []
    for key in ("frame_count", "fps", "duration_s", "camera", "samples"):
        if before_walk[key] != after_walk[key]:
            out.append("the after walk's %s differs from the before walk's" % key)
    if before_parts["parts"] != after_parts["parts"]:
        out.append("the after walk's parts differ from the before walk's")
    return out


def after_problems(doc, changes_doc, before_walk, before_parts, after_walk, after_parts):
    out = [("the after truth keeps required_now hazard %s" % h["id"]) for h in doc["hazards"] if h["label"] == "required_now"]
    kept = sorted(e["id"] for e in changes_doc["hazards"] if e["change"] == "kept")
    have = sorted(h["id"] for h in doc["hazards"] if h["label"] == "recommended")
    if have != kept:
        out.append("the after truth keeps %s, changes.json keeps %s" % (have, kept))
    return out + route_problems(before_walk, before_parts, after_walk, after_parts)


class Files:
    def __init__(self, root):
        self.root = root
        self.docs = {}
        self.missing = []
        self.problems = []

    def need(self, scene, *names):
        for name in names:
            key = "%s/%s" % (scene, name)
            path = os.path.join(self.root, scene, name)
            if not os.path.isfile(path):
                self.missing.append(key)
                continue
            try:
                with open(path, encoding="utf-8") as f:
                    self.docs[key] = json.load(f)
            except (OSError, ValueError) as e:
                self.problems.append((key, "cannot be read as JSON: %s" % e))

    def get(self, scene, name):
        return self.docs.get("%s/%s" % (scene, name))

    def has(self, scene, *names):
        return all("%s/%s" % (scene, n) in self.docs for n in names)


def guarded(run, files):
    try:
        return run(files)
    except (KeyError, TypeError, ValueError, IndexError, AttributeError, house.HouseError) as e:
        return ["the files are malformed: %s: %s" % (type(e).__name__, e)]


def before_scene_problems(files):
    spec = files.get(BEFORE, "spec.json")
    walk, parts = files.get(BEFORE, "motion.json"), files.get(BEFORE, "parts.json")
    out = []
    if (walk, parts) != route.build(spec):
        out.append("motion.json and parts.json differ from the route built from the spec")
    return out + truth_problems(spec, files.get(BEFORE, "truth.json"), walk, files.get(BEFORE, "render.json"))


def after_scene_problems(files):
    spec, changes = files.get(BEFORE, "spec.json"), files.get(AFTER, "changes.json")
    after = house.after_spec(spec, changes, CATALOG, RULES)
    walk, parts = files.get(AFTER, "motion.json"), files.get(AFTER, "parts.json")
    out = []
    if (walk, parts) != route.build(after):
        out.append("motion.json and parts.json differ from the route built from the after spec")
    doc = files.get(AFTER, "truth.json")
    out += truth_problems(after, doc, walk, files.get(AFTER, "render.json"))
    return out + after_problems(doc, changes, files.get(BEFORE, "motion.json"), files.get(BEFORE, "parts.json"), walk, parts)


def check(root):
    """Returns the missing file keys, the (where, problem) pairs and the scenes that passed; a scene is judged only when every file it needs was read."""
    files = Files(root)
    files.need(BEFORE, "spec.json", *SCENE_FILES)
    files.need(AFTER, "changes.json", *SCENE_FILES)
    problems = list(files.problems)
    clean = []
    judged = (
        (BEFORE, files.has(BEFORE, "spec.json", *SCENE_FILES), before_scene_problems),
        (AFTER, files.has(AFTER, "changes.json", *SCENE_FILES) and files.has(BEFORE, "spec.json", "motion.json", "parts.json"), after_scene_problems),
    )
    for scene, ready, run in judged:
        if not ready:
            continue
        found = guarded(run, files)
        problems += [(scene, p) for p in found]
        if not found:
            clean.append(scene)
    return files.missing, problems, clean
