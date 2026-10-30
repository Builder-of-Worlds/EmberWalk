import math

from . import geom, schema

POSE_TOLERANCE_IN = 0.05
TURN_TOLERANCE_DEG = 0.1
SCHEMA = "emberwalk.recheck/1"
FILE = "synthetic-recheck-%s.png"
POSE_KEYS = ("pos_in", "heading_deg", "tilt_deg", "roll_deg")


class RecheckError(Exception):
    def __init__(self, kind, message):
        Exception.__init__(self, message)
        self.kind = kind


def turn_deg(a, b):
    m = geom.matmul(geom.transpose(a), b)
    cos = (m[0][0] + m[1][1] + m[2][2] - 1) / 2
    sin = math.sqrt((m[2][1] - m[1][2]) ** 2 + (m[0][2] - m[2][0]) ** 2 + (m[1][0] - m[0][1]) ** 2) / 2
    return math.degrees(math.atan2(sin, cos))


def pose_problem(pos_in, rotation, entry):
    pose = entry["pose"] if "pose" in entry else entry
    where = "%s: the after scene's camera at frame %d" % (entry["hazard_id"], entry["before_frame"])
    if max(abs(a - b) for a, b in zip(pos_in, pose["pos_in"])) > POSE_TOLERANCE_IN:
        return "%s is not at the before walk's position" % where
    want = geom.camera_rotation(pose["heading_deg"], pose["tilt_deg"], pose["roll_deg"])
    if turn_deg(rotation, want) > TURN_TOLERANCE_DEG:
        return "%s is not looking in the before walk's direction (heading, tilt or roll)" % where
    return None


def fate(after, hazard_id):
    if any(h["id"] == hazard_id for h in after["hazards"]):
        return "kept"
    if any(h["id"] == hazard_id for h in after.get("fixed", [])):
        return "fixed"
    return "removed"


def _pose(walk, frame):
    sample = walk["samples"][frame - 1]
    return {k: sample[k] for k in POSE_KEYS}


def _proof_frame(hazard):
    rows = hazard.get("frame_boxes") or []
    if not rows:
        raise RecheckError("refused", "%s is never in view in the before walk" % hazard["id"])
    return min(rows, key=lambda r: (-r["area_px"], r["frame"]))["frame"]


def _required(before):
    return [h for h in before["hazards"] if h["label"] == "required_now"]


def plan(before, walk):
    out = []
    for h in _required(before):
        frame = _proof_frame(h)
        out.append({"hazard_id": h["id"], "before_frame": frame, "pose": _pose(walk, frame), "file": FILE % h["id"]})
    return out


def build(before, walk, after, results):
    stills = []
    for entry in plan(before, walk):
        got = results[entry["hazard_id"]]
        still = dict(entry, sha256=got["sha256"], area_px=got["area_px"])
        if "box_px" in got:
            still["box_px"] = got["box_px"]
        stills.append(still)
    return {"schema": SCHEMA, "synthetic": True, "label": before["label"], "before": before["scene"], "scene": after["id"], "stills": stills}


def check(doc, before, walk, after):
    if not isinstance(doc, dict):
        raise RecheckError("invalid", "recheck: not an object")
    errs = schema.errors(doc, schema.load("recheck"))
    if errs:
        raise RecheckError("invalid", "recheck: " + "; ".join(errs))
    if doc["before"] != before["scene"]:
        raise RecheckError("refused", "recheck: the before scene is %s, not %s" % (before["scene"], doc["before"]))
    if doc["scene"] != after["id"]:
        raise RecheckError("refused", "recheck: the after scene is %s, not %s" % (after["id"], doc["scene"]))
    wanted = {h["id"]: h for h in _required(before)}
    seen = set()
    for still in doc["stills"]:
        hazard_id = still["hazard_id"]
        if hazard_id not in wanted:
            raise RecheckError("refused", "recheck: %s is not a required_now hazard of the before scene" % hazard_id)
        if hazard_id in seen:
            raise RecheckError("refused", "recheck: %s has more than one recheck still" % hazard_id)
        seen.add(hazard_id)
        frame = still["before_frame"]
        if frame > walk["frame_count"]:
            raise RecheckError("refused", "recheck: %s: before_frame %d is outside the before walk of %d frames" % (hazard_id, frame, walk["frame_count"]))
        if frame != _proof_frame(wanted[hazard_id]):
            raise RecheckError("refused", "recheck: %s: before_frame %d is not the frame where %s shows the most mask pixels" % (hazard_id, frame, hazard_id))
        if still["pose"] != _pose(walk, frame):
            raise RecheckError("refused", "recheck: %s: pose differs from the before walk's sample at frame %d" % (hazard_id, frame))
        if still["file"] != FILE % hazard_id:
            raise RecheckError("refused", "recheck: %s: file must be %s" % (hazard_id, FILE % hazard_id))
        if fate(after, hazard_id) == "removed" and still["area_px"] != 0:
            raise RecheckError("refused", "recheck: %s was removed but shows %d mask pixels" % (hazard_id, still["area_px"]))
    for hazard_id in wanted:
        if hazard_id not in seen:
            raise RecheckError("refused", "recheck: %s has no recheck still" % hazard_id)
