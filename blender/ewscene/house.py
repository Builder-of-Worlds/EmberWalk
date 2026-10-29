import copy
import json
import math
import os
import subprocess

from . import placement, schema, units

SPEC = "emberwalk.house-spec/1"
TRUTH = "emberwalk.house-truth/1"
CHANGES = "emberwalk.house-changes/1"
SCHEMAS = {SPEC: "house-spec", TRUTH: "house-truth"}
LABEL = "Synthetic sample house"
AXES = (
    "house axes: x east, y north, z up, origin at the south west corner of the footprint's bounding box, whole inches; "
    "a box is in its side frame: x along the wall from its start corner, its right end as seen from the yard, "
    "y out from the wall face, z up from the ground"
)
ZONE = {"0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2"}
NEAR_IN = 360
FIXED_KEYS = ("distance_in", "along_in", "size_in", "elevation_in")
AFTER_MAY_CHANGE = ("id", "state", "hazards", "fixed")
FACING = {(0, 1): "north", (0, -1): "south", (1, 0): "east", (-1, 0): "west"}
STANDOFF_IN = (120, 144)
NONCOMBUSTIBLE = ("fiber cement lap", "stucco", "metal")
STRUCTURE_SAFE = ("concrete", "asphalt", "gravel", "masonry", "metal")
STEPPED = ("porch", "deck", "landing")
STEPS_LEAD_TO = ("porch", "deck", "landing", "balcony")
NO_STEPS_IN = 8
BRANCH = "tree branch over roof"
CANOPY_OFF_WALL_IN = 60
WALK_CLEAR_IN = 24
WALK_STEP_IN = 6
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RULES_JS = "import { RULES } from '@emberwalk/rules'; console.log(JSON.stringify(RULES.map((r) => [r.id, r.concept, r.zone, r.statute])));"

SIDE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["length_in", "height_in", "facing", "clean"],
    "properties": {
        "length_in": {"type": "integer", "minimum": 60, "maximum": 2400},
        "height_in": {"type": "integer", "minimum": 84, "maximum": 360},
        "facing": {"enum": ["north", "south", "east", "west"]},
        "clean": {"type": "boolean"},
    },
}

CHANGES_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schema", "synthetic", "label", "scene", "hazards"],
    "properties": {
        "schema": {"const": CHANGES},
        "synthetic": {"const": True},
        "label": {"const": LABEL},
        "scene": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
        "hazards": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "change"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "change": {"enum": ["removed", "fixed", "kept"]},
                    "distance_in": {"type": "integer"},
                    "along_in": {"type": "integer", "minimum": 0},
                    "size_in": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "integer", "minimum": 1}},
                    "elevation_in": {"type": "integer", "minimum": 0},
                },
            },
        },
    },
}


class HouseError(Exception):
    def __init__(self, kind, message):
        super().__init__("house %s: %s" % (kind, message))
        self.kind = kind


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise HouseError("invalid", "%s: %s" % (path, e))


def load_rules(root=REPO):
    try:
        run = subprocess.run(["node", "--input-type=module", "-e", RULES_JS], cwd=root, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        raise HouseError("refused", "rules package not read, node did not run: %s" % e)
    if run.returncode != 0:
        raise HouseError("refused", "rules package not read: %s" % run.stderr.strip()[-300:])
    try:
        rules = {i: {"concept": c, "zone": z, "statute": s} for i, c, z, s in json.loads(run.stdout)}
    except (ValueError, TypeError):
        raise HouseError("refused", "rules package printed something that is not its rule list")
    if not rules:
        raise HouseError("refused", "rules package lists no rules")
    return rules


def validate(doc, catalog, rules):
    if not isinstance(doc, dict):
        raise HouseError("invalid", "not an object")
    if doc.get("synthetic") is not True:
        raise HouseError("refused", "synthetic must be true")
    if doc.get("label") != LABEL:
        raise HouseError("refused", 'label must be "%s"' % LABEL)
    kind = doc.get("schema")
    name = SCHEMAS.get(kind) if isinstance(kind, str) else None
    if name is None:
        raise HouseError("invalid", "schema %s is not %s or %s" % (json.dumps(kind), SPEC, TRUTH))
    errs = schema.errors(doc, schema.load(name))
    if errs:
        raise HouseError("invalid", "; ".join(errs))
    eds = _footprint(doc)
    if kind == SPEC:
        _look(doc, catalog)
    _items(doc, catalog, rules, eds)
    if kind == SPEC:
        _trees(doc, catalog, eds)
    _clean_sides(doc)
    if doc["state"] == "before":
        _demo_bar(doc)
    return doc


def _asset(catalog, asset_id, kinds, where):
    entry = catalog.get(asset_id)
    if entry is None:
        raise HouseError("refused", "%s: unknown asset %s" % (where, asset_id))
    if entry["kind"] not in kinds:
        raise HouseError("refused", "%s: %s is not a %s" % (where, asset_id, " or ".join(kinds)))
    return entry


def edges(doc):
    ring = doc["footprint"]
    out = []
    for i, entry in enumerate(ring):
        (ax, ay), (bx, by) = entry["start_in"], ring[(i + 1) % len(ring)]["start_in"]
        if (ax == bx) == (ay == by):
            raise HouseError("invalid", "footprint: side %s does not run north, south, east or west" % entry["side"])
        u = ((bx > ax) - (bx < ax), (by > ay) - (by < ay))
        n = (-u[1], u[0])
        out.append({"side": entry["side"], "start": (ax, ay), "end": (bx, by), "u": u, "n": n,
                    "length_in": abs(bx - ax) + abs(by - ay), "facing": FACING[n]})
    return out


def _touch(e, f):
    return (min(e["start"][0], e["end"][0]) <= max(f["start"][0], f["end"][0]) and min(f["start"][0], f["end"][0]) <= max(e["start"][0], e["end"][0])
            and min(e["start"][1], e["end"][1]) <= max(f["start"][1], f["end"][1]) and min(f["start"][1], f["end"][1]) <= max(e["start"][1], e["end"][1]))


def _ring(eds, what):
    twice_area = sum(e["start"][0] * e["end"][1] - e["end"][0] * e["start"][1] for e in eds)
    if twice_area >= 0:
        raise HouseError("invalid", "%s: the ring encloses no area or runs anticlockwise; list the sides clockwise seen from above" % what)
    count = len(eds)
    for i, e in enumerate(eds):
        if e["u"][0] * eds[i - 1]["u"][0] + e["u"][1] * eds[i - 1]["u"][1] != 0:
            raise HouseError("invalid", "%s: sides %s and %s do not meet at a right angle" % (what, eds[i - 1]["side"], e["side"]))
        for j in range(i + 2, count):
            if (i, j) != (0, count - 1) and _touch(e, eds[j]):
                raise HouseError("invalid", "%s: sides %s and %s cross" % (what, e["side"], eds[j]["side"]))


def plan_rect(edge, along, distance, width, depth):
    (sx, sy), (ux, uy), (nx, ny) = edge["start"], edge["u"], edge["n"]
    xs = [sx + ux * a + nx * d for a in (along, along + width) for d in (distance, distance + depth)]
    ys = [sy + uy * a + ny * d for a in (along, along + width) for d in (distance, distance + depth)]
    return (min(xs), min(ys), max(xs), max(ys))


def _inside(eds, x, y):
    crossings = 0
    for e in eds:
        (ax, ay), (bx, by) = e["start"], e["end"]
        if ax == bx and ax > x and min(ay, by) <= y < max(ay, by):
            crossings += 1
    return crossings % 2 == 1


def _edge_through(rect, eds):
    x0, y0, x1, y1 = rect
    for e in eds:
        (ax, ay), (bx, by) = e["start"], e["end"]
        if ax == bx and x0 < ax < x1 and min(ay, by) < y1 and max(ay, by) > y0:
            return True
        if ay == by and y0 < ay < y1 and min(ax, bx) < x1 and max(ax, bx) > x0:
            return True
    return False


def overlaps_house(rect, eds):
    return _edge_through(rect, eds) or _inside(eds, (rect[0] + rect[2]) / 2.0, (rect[1] + rect[3]) / 2.0)


def _in_lot(rect, lot):
    return lot["min_in"][0] <= rect[0] and lot["min_in"][1] <= rect[1] and rect[2] <= lot["max_in"][0] and rect[3] <= lot["max_in"][1]


def _on_side(where, item, width, sides):
    side = sides.get(item["side"])
    if side is None:
        raise HouseError("refused", "%s: side %s is not in the house" % (where, item["side"]))
    if item["along_in"] + width > side["length_in"]:
        raise HouseError("invalid", "%s: runs past the wall end at %d in" % (where, side["length_in"]))


def _footprint(doc):
    eds = edges(doc)
    _ring(eds, "footprint")
    names = [e["side"] for e in eds]
    for name in names:
        if names.count(name) > 1:
            raise HouseError("invalid", "footprint: side %s is named twice" % name)
    sides = doc["sides"]
    for name in names:
        if name not in sides:
            raise HouseError("invalid", "sides: missing %s (named in the footprint)" % name)
    for name in sides:
        if name not in names:
            raise HouseError("invalid", "sides: %s is not in the footprint" % name)
    for e in eds:
        errs = schema.errors(sides[e["side"]], SIDE_SCHEMA, "$.sides.%s" % e["side"])
        if errs:
            raise HouseError("invalid", "; ".join(errs))
        side = sides[e["side"]]
        if side["length_in"] != e["length_in"]:
            raise HouseError("invalid", "sides.%s.length_in is %d, the footprint side is %d in" % (e["side"], side["length_in"], e["length_in"]))
        if side["facing"] != e["facing"]:
            raise HouseError("invalid", "sides.%s.facing is %s, the footprint faces it %s" % (e["side"], side["facing"], e["facing"]))
    if min(e["start"][0] for e in eds) != 0 or min(e["start"][1] for e in eds) != 0:
        raise HouseError("invalid", "footprint: the south west corner of its bounding box must be the origin")
    if doc["schema"] == SPEC:
        if "front" not in sides:
            raise HouseError("invalid", "footprint: no side is named front")
        door = doc["front_door"]
        _on_side("front_door", door, door["width_in"], sides)
        if "back_door" in doc:
            _on_side("back_door", doc["back_door"], doc["back_door"]["width_in"], sides)
        features = doc["house"]["features"]
        if "chimney" in features:
            _on_side("chimney", features["chimney"], features["chimney"]["size_in"][0], sides)
        for i, vent in enumerate(features["foundation_vents"]):
            _on_side("foundation_vents[%d]" % i, vent, vent["width_in"], sides)
        _openings(doc, sides)
        _lot_and_structures(doc, eds)
        if "roof" in doc["house"]:
            _roof(doc, eds)
    return eds


def _openings(doc, sides):
    features = doc["house"]["features"]
    placed = [(key, doc[key]["side"], doc[key]["along_in"], doc[key]["along_in"] + doc[key]["width_in"], 0, math.inf)
              for key in ("front_door", "back_door") if key in doc]
    asked = [("garage_door", features["garage_door"], 0)] if "garage_door" in features else []
    asked += [("windows[%d]" % i, w, w["sill_in"]) for i, w in enumerate(features.get("windows", []))]
    for where, item, low in asked:
        _on_side(where, item, item["width_in"], sides)
        a0, a1, top = item["along_in"], item["along_in"] + item["width_in"], low + item["height_in"]
        if top > sides[item["side"]]["height_in"]:
            raise HouseError("refused", "%s: its top at %d in passes the wall height %d in" % (where, top, sides[item["side"]]["height_in"]))
        for name, side, b0, b1, z0, z1 in placed:
            if side == item["side"] and a0 < b1 and b0 < a1 and low < z1 and z0 < top:
                raise HouseError("refused", "%s: overlaps %s" % (where, name))
        placed.append((where, item["side"], a0, a1, low, top))


def _roof(doc, eds):
    rects = []
    for i, b in enumerate(doc["house"]["roof"]["blocks"]):
        where = "house.roof.blocks[%d]" % i
        rect = tuple(b["min_in"]) + tuple(b["max_in"])
        if rect[0] >= rect[2] or rect[1] >= rect[3]:
            raise HouseError("invalid", "%s: min_in must be south west of max_in" % where)
        if _edge_through(rect, eds) or not _inside(eds, (rect[0] + rect[2]) / 2.0, (rect[1] + rect[3]) / 2.0):
            raise HouseError("refused", "%s: runs outside the walls" % where)
        for j, other in enumerate(rects):
            if _overlap(rect, other):
                raise HouseError("refused", "%s: overlaps blocks[%d]" % (where, j))
        rects.append(rect)
    area = -sum(e["start"][0] * e["end"][1] - e["end"][0] * e["start"][1] for e in eds) / 2
    if sum((r[2] - r[0]) * (r[3] - r[1]) for r in rects) != area:
        raise HouseError("refused", "house.roof: the blocks leave part of the house uncovered")


def _lot_and_structures(doc, eds):
    lot = doc["lot"]
    if not _in_lot((0, 0, max(e["start"][0] for e in eds), max(e["start"][1] for e in eds)), lot):
        raise HouseError("refused", "lot: the house is not inside the lot")
    seen = set()
    for i, s in enumerate(doc["structures"]):
        where = "structures[%d] %s" % (i, s["id"])
        if s["id"] in seen:
            raise HouseError("refused", "%s: id used twice" % where)
        seen.add(s["id"])
        rect = tuple(s["min_in"]) + tuple(s["max_in"])
        if rect[0] >= rect[2] or rect[1] >= rect[3]:
            raise HouseError("invalid", "%s: min_in must be south west of max_in" % where)
        if not _in_lot(rect, lot):
            raise HouseError("refused", "%s: runs outside the lot" % where)
        if overlaps_house(rect, eds):
            raise HouseError("refused", "%s: runs into the house" % where)
        if s["material"] not in STRUCTURE_SAFE:
            raise HouseError("refused", "%s: %s burns; a structure that burns is a hazard, not decoration" % (where, s["material"]))
    for i, s in enumerate(doc["structures"]):
        where = "structures[%d] %s" % (i, s["id"])
        near = [t["kind"] for t in doc["structures"] if t is not s and _abut(s, t)]
        if s["kind"] in STEPPED and s["height_in"] > NO_STEPS_IN and "steps" not in near:
            raise HouseError("refused", "%s: %d in up with no steps" % (where, s["height_in"]))
        if s["kind"] == "steps" and not set(near) & set(STEPS_LEAD_TO):
            raise HouseError("refused", "%s: the steps lead to no porch, deck, landing or balcony" % where)


def _abut(a, b):
    (ax0, ay0), (ax1, ay1), (bx0, by0), (bx1, by1) = a["min_in"], a["max_in"], b["min_in"], b["max_in"]
    side_by_side = (ax1 == bx0 or bx1 == ax0) and min(ay1, by1) > max(ay0, by0)
    end_to_end = (ay1 == by0 or by1 == ay0) and min(ax1, bx1) > max(ax0, bx0)
    return side_by_side or end_to_end


def _look(doc, catalog):
    look, siding = doc["look"], doc["house"]["siding"]
    if siding not in NONCOMBUSTIBLE:
        raise HouseError("refused", "house.siding: %s burns; every wall takes one non combustible siding, %s" % (siding, ", ".join(NONCOMBUSTIBLE)))
    texture = _asset(catalog, look["siding"]["material"], ("texture",), "look.siding.material")
    if siding not in texture.get("sidings", []):
        raise HouseError("refused", "look.siding.material: %s is not a %s siding texture" % (look["siding"]["material"], siding))
    _asset(catalog, look["roof"]["material"], ("texture",), "look.roof.material")
    _asset(catalog, look["ground"]["material"], ("texture",), "look.ground.material")
    _asset(catalog, look["light"]["hdri"], ("hdri",), "look.light.hdri")
    if "concrete" in look:
        _asset(catalog, look["concrete"]["material"], ("texture",), "look.concrete.material")


def _placed(where, item, doc, catalog, eds):
    if item["side"] not in doc["sides"]:
        raise HouseError("refused", "%s: side %s is not in the house" % (where, item["side"]))
    d = item["distance_in"]
    if d < 0:
        raise HouseError("refused", "%s: negative distance %d" % (where, d))
    if d > placement.MAX_DISTANCE_IN:
        raise HouseError("refused", "%s: %d in is past 100 feet" % (where, d))
    entry = _asset(catalog, item["asset"], ("model", "scripted"), where + ".asset")
    if item["concept"] not in entry["concepts"]:
        raise HouseError("refused", "%s: %s is not a %s" % (where, item["asset"], item["concept"]))
    if doc["schema"] == SPEC:
        _on_side(where, item, item["size_in"][0], doc["sides"])
        edge = next(e for e in eds if e["side"] == item["side"])
        rect = plan_rect(edge, item["along_in"], d, item["size_in"][0], item["size_in"][1])
        if overlaps_house(rect, eds):
            raise HouseError("refused", "%s: its box runs into the house" % where)
        if not _in_lot(rect, doc["lot"]):
            raise HouseError("refused", "%s: its box runs outside the lot" % where)


def _rule(where, h, rules):
    rule = rules.get(h["rule_id"])
    if rule is None:
        raise HouseError("refused", "%s: rule_id %s is not in the rules package" % (where, h["rule_id"]))
    concept = h["concept"].replace(" ", "_")
    if rule["concept"] != concept:
        raise HouseError("refused", "%s: rule_id %s is for %s, not %s" % (where, h["rule_id"], rule["concept"], h["concept"]))
    if rule["zone"] != ZONE[h["band"]]:
        raise HouseError("refused", "%s: rule_id %s is for %s, the hazard is in band %s" % (where, h["rule_id"], rule["zone"], h["band"]))
    if rule["statute"] == "vhfhsz":
        raise HouseError("refused", "%s: rule_id %s is the Very High zone statute; this house is in the State Responsibility Area" % (where, h["rule_id"]))


def _items(doc, catalog, rules, eds):
    seen = set()
    for i, h in enumerate(doc["hazards"]):
        where = "hazards[%d] %s" % (i, h["id"])
        if h["id"] in seen:
            raise HouseError("refused", "%s: hazard id used twice" % where)
        seen.add(h["id"])
        _placed(where, h, doc, catalog, eds)
        d = h["distance_in"]
        if h["band"] != placement.band(d):
            raise HouseError("refused", "%s: band %s does not match %d in, which is band %s" % (where, h["band"], d, placement.band(d)))
        if h["contact"] and d > 0:
            raise HouseError("refused", "%s: contact is true but the hazard is %d in from the wall" % (where, d))
        _rule(where, h, rules)
    for i, f in enumerate(doc.get("fixed", [])):
        where = "fixed[%d] %s" % (i, f["id"])
        if f["id"] in seen:
            raise HouseError("refused", "%s: id used twice" % where)
        seen.add(f["id"])
        _placed(where, f, doc, catalog, eds)


def _clean_sides(doc):
    for name, side in doc["sides"].items():
        near = [h["id"] for h in doc["hazards"] if h["side"] == name and h["distance_in"] <= NEAR_IN]
        if side["clean"] and near:
            raise HouseError("refused", "clean side %s has hazards within 30 ft: %s" % (name, ", ".join(near)))


def _overlap(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _ring_dist(p, eds):
    out = []
    for e in eds:
        (ax, ay), (bx, by) = e["start"], e["end"]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / float(dx * dx + dy * dy)))
        out.append(math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
    return min(out)


def _rect_dist(p, rect):
    return math.hypot(max(rect[0] - p[0], 0, p[0] - rect[2]), max(rect[1] - p[1], 0, p[1] - rect[3]))


def _trees(doc, catalog, eds):
    trees = doc.get("trees", [])
    if not trees:
        return
    objects = {o["id"]: o for o in doc["hazards"] + doc.get("fixed", [])}
    by_side = {e["side"]: e for e in eds}
    boxes = {i: plan_rect(by_side[o["side"]], o["along_in"], o["distance_in"], o["size_in"][0], o["size_in"][1]) for i, o in objects.items()}
    walks = [(s, loop(doc, s)) for s in range(STANDOFF_IN[0], STANDOFF_IN[1] + 1, WALK_STEP_IN)]
    hazard_ids = {h["id"] for h in doc["hazards"]}
    seen, carried = set(objects), set()
    for i, t in enumerate(trees):
        where = "trees[%d] %s" % (i, t["id"])
        if t["id"] in seen:
            raise HouseError("refused", "%s: id used twice" % where)
        seen.add(t["id"])
        if "tree" not in _asset(catalog, t["asset"], ("model", "scripted"), where + ".asset")["concepts"]:
            raise HouseError("refused", "%s: %s is not a tree" % (where, t["asset"]))
        if t["canopy_in"] < t["trunk_in"]:
            raise HouseError("invalid", "%s: its canopy is narrower than its trunk" % where)
        (x, y), k, r = t["at_in"], t["trunk_in"] / 2.0, t["canopy_in"] / 2.0
        trunk = (x - k, y - k, x + k, y + k)
        if not _in_lot((x - r, y - r, x + r, y + r), doc["lot"]):
            raise HouseError("refused", "%s: its canopy runs outside the lot" % where)
        if overlaps_house(trunk, eds):
            raise HouseError("refused", "%s: its trunk runs into the house" % where)
        for s in doc["structures"]:
            if _overlap(trunk, tuple(s["min_in"]) + tuple(s["max_in"])):
                raise HouseError("refused", "%s: its trunk stands on %s" % (where, s["id"]))
        for obj_id, box in boxes.items():
            if _overlap(trunk, box):
                raise HouseError("refused", "%s: its trunk stands in %s" % (where, obj_id))
        for standoff, ring in walks:
            clear = _ring_dist((x, y), ring) - k
            if clear < WALK_CLEAR_IN:
                raise HouseError("refused", "%s: its trunk is in the walk, %d in from the loop at %d in out" % (where, clear, standoff))
        gap = _ring_dist((x, y), eds) - r
        if gap < CANOPY_OFF_WALL_IN:
            raise HouseError("refused", "%s: its canopy reaches %d in from the house; it stays 5 ft off the walls and a branch nearer is a hazard" % (where, gap))
        for b in t["branches"]:
            if b in carried:
                raise HouseError("refused", "%s: branch %s is named twice" % (where, b))
            carried.add(b)
            if b not in objects:
                if doc["state"] == "before":
                    raise HouseError("refused", "%s: names branch %s, which is not a hazard" % (where, b))
                continue
            if objects[b]["concept"] != BRANCH:
                raise HouseError("refused", "%s: %s is not a %s" % (where, b, BRANCH))
            if b in hazard_ids and _rect_dist((x, y), boxes[b]) > r:
                raise HouseError("refused", "%s: branch %s does not reach its canopy" % (where, b))


def _demo_bar(doc):
    bands = [h["band"] for h in doc["hazards"]]
    if bands.count("0_5") < 2:
        raise HouseError("refused", "fewer than two hazards in 0_5 (%d)" % bands.count("0_5"))
    if "30_100" not in bands:
        raise HouseError("refused", "no hazard in 30_100")


def truth_from_spec(spec):
    hazards = []
    for h in spec["hazards"]:
        w, depth, height = h["size_in"]
        x, y, z = h["along_in"], h["distance_in"], h["elevation_in"]
        hazards.append({
            "id": h["id"],
            "concept": h["concept"],
            "side": h["side"],
            "distance_in": y,
            "distance_ft": round(y / 12.0, 2),
            "distance_text": units.feet_inches(y),
            "band": h["band"],
            "contact": h["contact"],
            "label": h["label"],
            "rule": h["rule"],
            "rule_id": h["rule_id"],
            "asset": h["asset"],
            "box_in": {"min": [x, y, z], "max": [x + w, y + depth, z + height]},
        })
    return {
        "schema": TRUTH,
        "synthetic": True,
        "label": spec["label"],
        "scene": spec["id"],
        "state": spec["state"],
        "units": "inch",
        "axes": AXES,
        "footprint": copy.deepcopy(spec["footprint"]),
        "sides": copy.deepcopy(spec["sides"]),
        "hazards": hazards,
    }


def _scan_entry(entry, fields):
    name = entry.get("id")
    for key in entry:
        if key in fields and key != "id" and key not in FIXED_KEYS:
            raise HouseError("refused", "changes: %s changes %s; only placement or size may change" % (name, key))
    if "change" in entry and entry["change"] != "fixed" and any(k in entry for k in FIXED_KEYS):
        raise HouseError("refused", "changes: %s is %s but carries a new placement; only a fixed hazard carries one" % (name, entry["change"]))


def _entries(before, doc):
    if not isinstance(doc, dict):
        raise HouseError("invalid", "changes: not an object")
    if doc.get("synthetic") is not True:
        raise HouseError("refused", "changes: synthetic must be true")
    if doc.get("label") != LABEL:
        raise HouseError("refused", 'changes: label must be "%s"' % LABEL)
    for key in doc:
        if key not in CHANGES_SCHEMA["properties"] and key in before:
            raise HouseError("refused", "changes: only hazards may change: %s" % key)
    fields = set(schema.load("house-spec")["properties"]["hazards"]["items"]["properties"])
    if isinstance(doc.get("hazards"), list):
        for entry in doc["hazards"]:
            if isinstance(entry, dict):
                _scan_entry(entry, fields)
    errs = schema.errors(doc, CHANGES_SCHEMA)
    if errs:
        raise HouseError("invalid", "changes: " + "; ".join(errs))
    have = [h["id"] for h in before["hazards"]]
    named = [e["id"] for e in doc["hazards"]]
    for hazard_id in named:
        if hazard_id not in have:
            raise HouseError("refused", "changes: the before scene does not have %s" % hazard_id)
    if sorted(named) != sorted(have):
        raise HouseError("refused", "changes: must name every hazard once, %d named, %d in the scene" % (len(named), len(have)))
    for entry in doc["hazards"]:
        if entry["change"] == "fixed" and not any(k in entry for k in FIXED_KEYS):
            raise HouseError("invalid", "changes: fixed hazard %s has no new placement or size" % entry["id"])
    return {e["id"]: e for e in doc["hazards"]}


def _fixed(hazard, entry):
    obj = {k: copy.deepcopy(hazard[k]) for k in ("id", "concept", "asset", "side", "distance_in", "along_in", "size_in", "elevation_in")}
    obj.update({k: copy.deepcopy(entry[k]) for k in FIXED_KEYS if k in entry})
    obj["contact"] = hazard["contact"] and obj["distance_in"] == 0
    return obj


def check_after(before, after):
    rest_before = {k: v for k, v in before.items() if k not in AFTER_MAY_CHANGE}
    rest_after = {k: v for k, v in after.items() if k not in AFTER_MAY_CHANGE}
    if rest_before != rest_after:
        differing = sorted(k for k in set(rest_before) | set(rest_after) if rest_before.get(k) != rest_after.get(k))
        raise HouseError("refused", "an after scene may change only hazards; %s differs" % ", ".join(differing))
    for h in after["hazards"]:
        if h["label"] == "required_now":
            raise HouseError("refused", "after scene keeps required_now hazard %s" % h["id"])
    if not any(h["label"] == "recommended" for h in after["hazards"]):
        raise HouseError("refused", "after scene keeps no recommended hazard")


def after_spec(before, changes, catalog, rules):
    if not isinstance(before, dict) or before.get("schema") != SPEC or before.get("state") != "before":
        raise HouseError("refused", "changes apply to a before house spec")
    entries = _entries(before, changes)
    after = copy.deepcopy(before)
    after["id"] = changes["scene"]
    after["state"] = "after"
    after["hazards"] = [copy.deepcopy(h) for h in before["hazards"] if entries[h["id"]]["change"] == "kept"]
    after["fixed"] = [_fixed(h, entries[h["id"]]) for h in before["hazards"] if entries[h["id"]]["change"] == "fixed"]
    check_after(before, after)
    return validate(after, catalog, rules)


def summary(doc):
    hazards = doc["hazards"]
    bands = {b: sum(1 for h in hazards if h["band"] == b) for b in ZONE}
    labels = {k: sum(1 for h in hazards if h["label"] == k) for k in ("required_now", "recommended")}
    clean = [name for name, side in doc["sides"].items() if side["clean"]]
    return "HOUSE OK %s %s %s: %d hazards (0_5 %d, 5_30 %d, 30_100 %d), required_now %d, recommended %d, clean side %s" % (
        doc.get("id") or doc["scene"], "spec" if doc["schema"] == SPEC else "truth", doc["state"], len(hazards),
        bands["0_5"], bands["5_30"], bands["30_100"], labels["required_now"], labels["recommended"], ", ".join(clean) or "none")


def after_summary(before, after):
    kept, fixed = len(after["hazards"]), len(after["fixed"])
    return "after %s: kept %d, fixed %d, removed %d" % (after["id"], kept, fixed, len(before["hazards"]) - kept - fixed)


def _bearing(v):
    return round(math.degrees(math.atan2(v[0], v[1]))) % 360


def loop(doc, standoff_in):
    if not STANDOFF_IN[0] <= standoff_in <= STANDOFF_IN[1]:
        raise HouseError("refused", "loop: standoff %d in is outside %d to %d in" % (standoff_in, STANDOFF_IN[0], STANDOFF_IN[1]))
    eds = edges(doc)
    corners = [(e["start"][0] + standoff_in * (eds[i - 1]["n"][0] + e["n"][0]), e["start"][1] + standoff_in * (eds[i - 1]["n"][1] + e["n"][1]))
               for i, e in enumerate(eds)]
    ring = [{"side": e["side"], "start_in": list(c)} for e, c in zip(eds, corners)]
    out = edges({"footprint": ring})
    for e, o in zip(eds, out):
        if e["u"] != o["u"]:
            raise HouseError("refused", "loop: at %d in out the walk folds over itself along side %s" % (standoff_in, e["side"]))
    _ring(out, "loop")
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    if not _in_lot((min(xs), min(ys), max(xs), max(ys)), doc["lot"]):
        raise HouseError("refused", "loop: the walk leaves the lot")
    return out


def pans(doc, standoff_in):
    eds, ring = edges(doc), loop(doc, standoff_in)
    start = next(i for i, e in enumerate(eds) if e["side"] == "front")
    out = []
    for k in range(len(eds)):
        i = (start + k) % len(eds)
        e, o, nxt = eds[i], ring[i], eds[(i + 1) % len(eds)]
        out.append({"kind": "side", "side": e["side"], "at_in": [(o["start"][0] + o["end"][0]) / 2.0, (o["start"][1] + o["end"][1]) / 2.0],
                    "bearing_deg": _bearing(e["n"])})
        out.append({"kind": "corner", "sides": [e["side"], nxt["side"]], "at_in": list(o["end"]),
                    "bearing_deg": _bearing((e["n"][0] + nxt["n"][0], e["n"][1] + nxt["n"][1]))})
    if math.dist(door_point(doc, standoff_in), ring[start]["start"]) > ring[start]["length_in"] / 2.0:
        out = out[1:] + out[:1]
    return out


def door_point(doc, standoff_in):
    loop(doc, standoff_in)
    door = doc["front_door"]
    e = next(e for e in edges(doc) if e["side"] == "front")
    along = door["along_in"] + door["width_in"] / 2.0
    return [e["start"][0] + e["u"][0] * along + e["n"][0] * standoff_in, e["start"][1] + e["u"][1] * along + e["n"][1] * standoff_in]


def loop_length_in(doc, standoff_in):
    return sum(o["length_in"] for o in loop(doc, standoff_in))


def _num(v):
    return int(v) if v == int(v) else v


def _span(b):
    axis = 1 if b["ridge"] == "east_west" else 0
    return axis, (b["max_in"][axis] - b["min_in"][axis]) / 2.0


def _run_in(b, others, end):
    axis, _ = _span(b)
    run = 1 - axis
    line = b["max_in"][run] if end else b["min_in"][run]
    for n in others:
        if (n["min_in"][run] if end else n["max_in"][run]) != line:
            continue
        if not (n["min_in"][axis] < b["max_in"][axis] and b["min_in"][axis] < n["max_in"][axis]):
            continue
        n_axis, n_half = _span(n)
        if n_axis == axis:
            return 0
        return min(n_half, b["rise_in"] * n_half / n["rise_in"])
    return None


def roof_prisms(doc):
    roof = doc["house"].get("roof")
    if roof is None:
        raise HouseError("refused", "house.roof is missing; the scene needs it to build")
    eave = roof["eave_in"]
    wall = max(s["height_in"] for s in doc["sides"].values())
    out = []
    for b in roof["blocks"]:
        axis, half = _span(b)
        run = 1 - axis
        others = [n for n in roof["blocks"] if n is not b]
        lo, hi = [v - eave for v in b["min_in"]], [v + eave for v in b["max_in"]]
        for end, bound in ((False, lo), (True, hi)):
            extra = _run_in(b, others, end)
            if extra is not None:
                bound[run] = b["max_in"][run] + extra if end else b["min_in"][run] - extra
        out.append({"ridge": b["ridge"], "lo": [_num(v) for v in lo], "hi": [_num(v) for v in hi], "wall_in": wall,
                    "eave_z_in": _num(wall - eave * b["rise_in"] / half), "ridge_z_in": wall + b["rise_in"]})
    return out


def _clip(lo, hi, cuts):
    pieces = [(lo, hi)]
    for c0, c1 in cuts:
        pieces = [q for a, b in pieces for q in ((a, min(b, c0)), (max(a, c1), b)) if q[1] > q[0]]
    return pieces


def gutter_runs(doc):
    if not doc["house"]["features"]["gutters"]:
        return []
    prisms = roof_prisms(doc)
    out = []
    for p in prisms:
        axis = 1 if p["ridge"] == "east_west" else 0
        run = 1 - axis
        for at, facing in ((p["lo"][axis], ("west", "south")[axis]), (p["hi"][axis], ("east", "north")[axis])):
            cuts = [(q["lo"][run], q["hi"][run]) for q in prisms if q is not p and q["lo"][axis] <= at <= q["hi"][axis]]
            for a, b in _clip(p["lo"][run], p["hi"][run], cuts):
                start, end = [0, 0], [0, 0]
                start[axis], end[axis], start[run], end[run] = at, at, a, b
                out.append({"facing": facing, "start": start, "end": end, "z_in": p["eave_z_in"]})
    return out


def used_assets(doc, catalog):
    look = doc["look"]
    ids = [look["siding"]["material"], look["roof"]["material"], look["ground"]["material"], look["light"]["hdri"]]
    if "concrete" in look:
        ids.append(look["concrete"]["material"])
    for item in doc["hazards"] + doc.get("fixed", []) + doc.get("trees", []):
        ids.append(item["asset"])
        if "material" in catalog[item["asset"]]:
            ids.append(catalog[item["asset"]]["material"])
    return [{"id": i, "kind": catalog[i]["kind"], "license": catalog[i]["license"], "source": catalog[i].get("source")} for i in dict.fromkeys(ids)]
