import datetime
import json
import re
from decimal import Decimal

from . import maskbox, schema

LOOK = "emberwalk.openart-look/1"
MIX = "emberwalk.mix-list/1"
IOU_MIN = 0.5
IOU_TOLERANCE = 0.01
CLIP_FRAME_SLACK = 1
LABEL = "Synthetic sample house"
VIEWS = ("front", "east", "west", "north", "after_front")
REFERENCES = ("board", "blender_frame", "still", "none")
PICK_KEYS = ("picked_by", "picked_on", "copy")
PICKER = "owner"
COPY_MAX_BYTES = 500000
BLUR_MARGIN_PX = 8
BLUR_SIDES = ("left", "top", "right", "bottom")
SHA256 = re.compile(r"^[0-9a-f]{64}\Z")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")


class OpenArtError(Exception):
    def __init__(self, kind, message):
        super().__init__("openart %s: %s" % (kind, message))
        self.kind = kind


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise OpenArtError("invalid", "%s: %s" % (path, e))


def credit_sum(credits):
    total = sum((Decimal(str(c)) for c in credits), Decimal(0))
    return int(total) if total == total.to_integral_value() else float(total)


def fmt(n):
    return format(Decimal(str(n)).normalize(), "f")


def _marked(doc):
    if not isinstance(doc, dict):
        raise OpenArtError("invalid", "not an object")
    if doc.get("synthetic") is not True:
        raise OpenArtError("refused", "synthetic must be true")
    if doc.get("label") != LABEL:
        raise OpenArtError("refused", 'label must be "%s"' % LABEL)


def _shape(doc, kind, name):
    if doc.get("schema") != kind:
        raise OpenArtError("invalid", "schema %s is not %s" % (json.dumps(doc.get("schema")), kind))
    errs = schema.errors(doc, schema.load(name))
    if errs:
        raise OpenArtError("invalid", "; ".join(errs))


def _file(where, entry, suffixes=None):
    name = entry["file"]
    if "/" in name or "\\" in name or name in (".", ".."):
        raise OpenArtError("refused", "%s: %s must be a bare file name" % (where, name))
    if not name.startswith("synthetic-"):
        raise OpenArtError("refused", "%s: %s does not start synthetic-" % (where, name))
    if not SHA256.match(entry["sha256"]):
        raise OpenArtError("refused", "%s: sha256 %s is not 64 hex characters" % (where, entry["sha256"]))
    if suffixes and not name.lower().endswith(suffixes):
        raise OpenArtError("refused", "%s: %s is not a JPEG" % (where, name))


def _reference(where, ref, own, originals):
    kind = ref["kind"]
    if kind not in REFERENCES:
        raise OpenArtError("refused", "%s: reference %s is not board, blender_frame, still or none" % (where, kind))
    if kind == "blender_frame" and "frame" not in ref:
        raise OpenArtError("refused", "%s: reference blender_frame needs its frame" % where)
    if kind != "blender_frame" and "frame" in ref:
        raise OpenArtError("refused", "%s: only a blender_frame has a frame" % where)
    if kind != "still":
        if "file" in ref:
            raise OpenArtError("refused", "%s: only a still reference has a file" % where)
        return
    if "file" not in ref:
        raise OpenArtError("refused", "%s: reference still needs its file" % where)
    if ref["file"] == own:
        raise OpenArtError("refused", "%s: a still cannot be its own reference" % where)
    if ref["file"] not in originals:
        raise OpenArtError("refused", "%s: reference %s is not a still in this file" % (where, ref["file"]))


def _pick(where, s):
    if s.get("chosen") is not True:
        if any(k in s for k in PICK_KEYS):
            raise OpenArtError("refused", "%s is not chosen but carries a pick" % where)
        return False
    if s.get("picked_by") != PICKER:
        raise OpenArtError("refused", "%s is chosen but not picked by %s" % (where, PICKER))
    day = s.get("picked_on", "")
    try:
        if not DATE.match(day):
            raise ValueError(day)
        datetime.date.fromisoformat(day)
    except ValueError:
        raise OpenArtError("refused", "%s has no pick date (YYYY-MM-DD)" % where)
    if "copy" not in s:
        raise OpenArtError("refused", "%s has no committed copy" % where)
    _file(where + " copy", s["copy"], (".jpg", ".jpeg"))
    if s["copy"]["bytes"] > COPY_MAX_BYTES:
        raise OpenArtError("refused", "%s copy is %d bytes, over %d bytes" % (where, s["copy"]["bytes"], COPY_MAX_BYTES))
    return True


def _blur(where, boxes):
    for n, b in enumerate(boxes, 1):
        g, box = b["glyphs"], b["box"]
        if g[2] <= g[0] or g[3] <= g[1]:
            raise OpenArtError("refused", "%s: blur %d glyphs have no area" % (where, n))
        if box[0] > g[0] or box[1] > g[1] or box[2] < g[2] or box[3] < g[3]:
            raise OpenArtError("refused", "%s: blur %d box does not cover its glyphs" % (where, n))
        margins = (g[0] - box[0], g[1] - box[1], box[2] - g[2], box[3] - g[3])
        for side, m in zip(BLUR_SIDES, margins):
            if m > BLUR_MARGIN_PX:
                raise OpenArtError("refused", "%s: blur %d has a margin of %d px on the %s, over %d px" % (where, n, m, side, BLUR_MARGIN_PX))


def validate_look(doc):
    _marked(doc)
    _shape(doc, LOOK, "openart-look")
    stills, picked = {v: 0 for v in VIEWS}, {v: 0 for v in VIEWS}
    originals, digests = {}, {}
    for i, s in enumerate(doc["stills"], 1):
        where = "still %d (%s)" % (i, s["view"])
        name, digest = s["original"]["file"], s["original"]["sha256"]
        if name in originals:
            raise OpenArtError("refused", "%s: original %s listed twice" % (where, name))
        if digest in digests:
            raise OpenArtError("refused", "%s: original has the same sha256 as still %d" % (where, digests[digest]))
        originals[name], digests[digest] = i, i
    for i, s in enumerate(doc["stills"], 1):
        where = "still %d (%s)" % (i, s["view"])
        if s["credits"] < 0:
            raise OpenArtError("refused", "%s: credits below 0" % where)
        _reference(where, s["reference"], s["original"]["file"], originals)
        _file(where + " original", s["original"])
        _blur(where, s.get("blur", []))
        stills[s["view"]] += 1
        picked[s["view"]] += _pick(where, s)
    for view in VIEWS:
        if not stills[view]:
            raise OpenArtError("refused", "no still for %s" % view)
        if picked[view] > 1:
            raise OpenArtError("refused", "two stills chosen for %s" % view)
        if not picked[view]:
            raise OpenArtError("refused", "no still picked for %s" % view)
    total = credit_sum(s["credits"] for s in doc["stills"])
    if Decimal(str(doc["credits_total"])) != Decimal(str(total)):
        raise OpenArtError("refused", "credits_total %s is not the sum of the stills' credits, %s" % (fmt(doc["credits_total"]), fmt(total)))
    return doc


def _iou(a, b):
    wide = min(a[2], b[2]) - max(a[0], b[0])
    high = min(a[3], b[3]) - max(a[1], b[1])
    inter = wide * high if wide > 0 and high > 0 else 0
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _truth_hazards(truth):
    hazards = truth.get("hazards") if isinstance(truth, dict) else None
    if not isinstance(hazards, list) or not hazards:
        raise OpenArtError("invalid", "truth has no hazards list")
    for h in hazards:
        boxes = h.get("frame_boxes") if isinstance(h, dict) else None
        if not isinstance(boxes, list) or not all(isinstance(r, dict) and {"frame", "box_px", "area_px"} <= set(r) for r in boxes) or "id" not in h or "concept" not in h:
            raise OpenArtError("invalid", "truth hazard without id, concept and frame_boxes")
    return hazards


def _cover(chunks, last):
    prev = 0
    for i, c in enumerate(chunks, 1):
        where = "chunk %d (frames %d to %d)" % (i, c["start"], c["end"])
        if c["end"] < c["start"]:
            raise OpenArtError("refused", "%s ends before it starts" % where)
        if c["end"] > last:
            raise OpenArtError("refused", "%s is outside the %d frame walk" % (where, last))
        if i == 1 and c["start"] != 1:
            raise OpenArtError("refused", "the list starts at frame %d, not frame 1" % c["start"])
        if i > 1 and c["start"] > prev + 1:
            raise OpenArtError("refused", "gap between frame %d and frame %d" % (prev, c["start"]))
        if i > 1 and c["start"] <= prev:
            raise OpenArtError("refused", "overlap at frame %d" % c["start"])
        prev = c["end"]
    if prev != last:
        raise OpenArtError("refused", "the list ends at frame %d, not frame %d" % (prev, last))


def _clip(where, c, art):
    if not c["start"] <= art["reference_frame"] <= c["end"]:
        raise OpenArtError("refused", "%s: reference frame %d is outside the chunk" % (where, art["reference_frame"]))
    if art["credits"] < 0:
        raise OpenArtError("refused", "%s: credits below 0" % where)
    _file(where + " clip", art["clip"])
    length = c["end"] - c["start"] + 1
    if abs(art["clip"]["frames"] - length) > CLIP_FRAME_SLACK:
        raise OpenArtError("refused", "%s: clip is %d frames, the chunk is %d" % (where, art["clip"]["frames"], length))


def _sam(where, c, sam, hazards):
    by_id = {h["id"]: h for h in hazards}
    checked = {e["id"]: e for e in sam.get("hazards", [])}
    for h in hazards:
        shown = any(c["start"] <= r["frame"] <= c["end"] and r["area_px"] >= maskbox.MIN_MASK_PX for r in h["frame_boxes"])
        entry = checked.get(h["id"])
        if shown and (entry is None or not entry["checks"]):
            raise OpenArtError("refused", "%s: the SAM check misses %s (%s), which the truth shows in the chunk" % (where, h["id"], h["concept"]))
    for hazard_id, entry in checked.items():
        h = by_id.get(hazard_id)
        if h is None or h["concept"] != entry["concept"]:
            raise OpenArtError("refused", "%s: %s (%s) is not a hazard of the truth" % (where, hazard_id, entry["concept"]))
        rows = {r["frame"]: r for r in h["frame_boxes"] if r["area_px"] >= maskbox.MIN_MASK_PX}
        for check in entry["checks"]:
            frame = check["frame"]
            if not c["start"] <= frame <= c["end"]:
                raise OpenArtError("refused", "%s: %s frame %d is outside the chunk" % (where, hazard_id, frame))
            if frame not in rows:
                raise OpenArtError("refused", "%s: %s frame %d has no truth box of %d mask pixels" % (where, hazard_id, frame, maskbox.MIN_MASK_PX))
            found = _iou(check["box_px"], rows[frame]["box_px"])
            if abs(found - check["iou"]) > IOU_TOLERANCE:
                raise OpenArtError("refused", "%s: %s frame %d records overlap %s, the boxes give %.2f" % (where, hazard_id, frame, check["iou"], found))
            if check["iou"] < IOU_MIN:
                raise OpenArtError("refused", "%s: %s frame %d has overlap %s, under %s" % (where, hazard_id, frame, check["iou"], IOU_MIN))


def validate_mix(doc, truth):
    _marked(doc)
    _shape(doc, MIX, "mix-list")
    hazards = _truth_hazards(truth)
    _cover(doc["chunks"], doc["frame_count"])
    latest = max((r["frame"] for h in hazards for r in h["frame_boxes"]), default=0)
    if latest > doc["frame_count"]:
        raise OpenArtError("refused", "the truth shows a box on frame %d of a %d frame walk" % (latest, doc["frame_count"]))
    for i, c in enumerate(doc["chunks"], 1):
        where = "chunk %d (%s, frames %d to %d)" % (i, c["part"], c["start"], c["end"])
        art = c.get("openart")
        if art is None:
            if c["source"] == "openart":
                raise OpenArtError("refused", "%s: source is openart but there is no OpenArt record" % where)
            continue
        _clip(where, c, art)
        sam = art["sam_check"]
        if c["source"] == "openart":
            if sam["status"] != "pass":
                raise OpenArtError("refused", "%s: source is openart but its SAM check is %s" % (where, sam["status"]))
            if "cost_nano_usd" not in sam:
                raise OpenArtError("refused", "%s: its SAM check has no SAM cost" % where)
        if sam["status"] == "pass":
            _sam(where, c, sam, hazards)
    credits, cost = mix_totals(doc)
    if Decimal(str(doc["credits_total"])) != Decimal(str(credits)):
        raise OpenArtError("refused", "credits_total %s is not the sum of the OpenArt credits, %s" % (fmt(doc["credits_total"]), fmt(credits)))
    if doc["sam_cost_total_nano_usd"] != cost:
        raise OpenArtError("refused", "sam_cost_total_nano_usd %d is not the sum of the SAM costs, %d" % (doc["sam_cost_total_nano_usd"], cost))
    return doc


def mix_totals(doc):
    tried = [c["openart"] for c in doc["chunks"] if "openart" in c]
    return credit_sum(a["credits"] for a in tried), sum(a["sam_check"].get("cost_nano_usd", 0) for a in tried)


def mix_summary(doc):
    credits, cost = mix_totals(doc)
    return "%s: %d chunks covering %d frames, %d from OpenArt, %s credits, %d nano USD SAM cost" % (
        doc["scene"], len(doc["chunks"]), doc["frame_count"], sum(1 for c in doc["chunks"] if c["source"] == "openart"), fmt(credits), cost)


def look_summary(doc):
    picked = sum(1 for s in doc["stills"] if s.get("chosen") is True)
    return "%s: %d stills, %d of %d views picked, %s credits" % (
        doc["scene"], len(doc["stills"]), picked, len(VIEWS), fmt(credit_sum(s["credits"] for s in doc["stills"])))
