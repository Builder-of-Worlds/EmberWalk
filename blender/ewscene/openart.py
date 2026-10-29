import datetime
import json
import re
from decimal import Decimal

from . import schema

LOOK = "emberwalk.openart-look/1"
LABEL = "Synthetic sample house"
VIEWS = ("front", "east", "west", "north", "after_front")
REFERENCES = ("board", "blender_frame", "still", "none")
PICK_KEYS = ("picked_by", "picked_on", "copy")
PICKER = "owner"
COPY_MAX_BYTES = 500000
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


def look_summary(doc):
    picked = sum(1 for s in doc["stills"] if s.get("chosen") is True)
    return "%s: %d stills, %d of %d views picked, %s credits" % (
        doc["scene"], len(doc["stills"]), picked, len(VIEWS), fmt(credit_sum(s["credits"] for s in doc["stills"])))
