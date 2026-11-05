import math
import random

from . import house, meadow, route

LOT_FORMS = house.LOT_TREE_ASSET
EDGE_MARGIN_IN = 120
FRONT_ARC_DEG = 50
HAZARD_CLEAR_IN = 150
BANDS = (
    {"name": "close", "reach_in": (330, 800), "count": 18, "gap": 0.22, "conifer": 0.3, "scale": (1.2, 1.3), "behind_and_beside": True},
    {"name": "near", "reach_in": (600, 980), "count": 26, "gap": 0.3, "conifer": 0.25, "scale": (1.0, 1.0)},
    {"name": "mid", "reach_in": (1000, 1560), "count": 56, "gap": 0.35, "conifer": 0.3, "scale": (1.0, 1.0)},
    {"name": "far", "reach_in": (1600, 2350), "count": 80, "gap": 0.5, "conifer": 0.35, "scale": (1.0, 1.0), "sky_deg": 4.5},
    {"name": "treeline", "reach_in": (2400, 4300), "count": 200, "gap": 0.45, "conifer": 0.45, "scale": (1.12, 1.18), "sky_deg": 2.5},
)
CONIFER = {"height_in": (540, 760), "canopy_in": (220, 300)}
OAK = {"height_in": (520, 700), "canopy_in": (440, 600)}
CAPS = {"conifer": (340, 900), "oak": (760, 760)}
ATTEMPTS = 6000


def _house_box(spec):
    eds = house.edges(spec)
    xs, ys = [e["start"][0] for e in eds], [e["start"][1] for e in eds]
    return min(xs), min(ys), max(xs), max(ys)


def _reach(box, x, y):
    return math.hypot(max(box[0] - x, 0.0, x - box[2]), max(box[1] - y, 0.0, y - box[3]))


def _blocked(spec, x, y):
    rects = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in spec["structures"]] + meadow.walk_lanes(spec)
    return any(r[0] - EDGE_MARGIN_IN <= x <= r[2] + EDGE_MARGIN_IN and r[1] - EDGE_MARGIN_IN <= y <= r[3] + EDGE_MARGIN_IN for r in rects)


def _tree(rng, band, n):
    form = "conifer" if rng.random() < band["conifer"] else "oak"
    sizes = CONIFER if form == "conifer" else OAK
    grow = rng.uniform(*band["scale"])
    canopy = min(round(rng.uniform(*sizes["canopy_in"]) * grow), CAPS[form][0])
    height = min(round(rng.uniform(*sizes["height_in"]) * grow), CAPS[form][1])
    return {"id": "wood-%03d" % n, "form": form, "canopy_in": canopy, "height_in": height, "trunk_in": round(canopy / 9.0)}


def _open(spec, centre, x, y):
    bearing = math.degrees(math.atan2(y - centre[1], x - centre[0]))
    for at, half in ((spec.get("look") or {}).get("woods") or {}).get("open", []):
        if abs((bearing - at + 180.0) % 360.0 - 180.0) <= half:
            return True
    return False


def _in_front(centre, x, y):
    bearing = math.degrees(math.atan2(y - centre[1], x - centre[0]))
    return abs((bearing + 90.0 + 180.0) % 360.0 - 180.0) <= FRONT_ARC_DEG


def _near_hazard(boxes, x, y, canopy):
    return any(math.hypot(max(b[0] - x, 0.0, x - b[3]), max(b[1] - y, 0.0, y - b[4])) <= 0.35 * canopy + HAZARD_CLEAR_IN for b in boxes)


def _lower(tree, band, reach):
    limit = band.get("sky_deg")
    if not limit:
        return
    cap = reach * math.tan(math.radians(limit))
    if tree["height_in"] <= cap:
        return
    k = cap / tree["height_in"]
    tree["height_in"] = round(cap)
    tree["canopy_in"] = round(tree["canopy_in"] * max(k, 0.6))
    tree["trunk_in"] = round(tree["canopy_in"] / 9.0)


def ring(spec):
    rng = random.Random(spec["id"] + " woods")
    box = _house_box(spec)
    centre = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)
    boxes = list(route.hazard_boxes(spec).values())
    placed = [(t["at_in"][0], t["at_in"][1], t["canopy_in"]) for t in spec.get("trees", [])]
    out = []
    for band in BANDS:
        lo, hi = band["reach_in"]
        span = hi + max(box[2] - box[0], box[3] - box[1])
        got, tries = 0, 0
        while got < band["count"] and tries < ATTEMPTS:
            tries += 1
            x, y = centre[0] + rng.uniform(-span, span), centre[1] + rng.uniform(-span, span)
            if not lo <= _reach(box, x, y) <= hi or _blocked(spec, x, y) or _open(spec, centre, x, y):
                continue
            tree = _tree(rng, band, len(out))
            _lower(tree, band, _reach(box, x, y))
            if band.get("behind_and_beside") and (_in_front(centre, x, y) or _near_hazard(boxes, x, y, tree["canopy_in"])):
                continue
            if any(math.hypot(x - px, y - py) < band["gap"] * (tree["canopy_in"] + pc) for px, py, pc in placed):
                continue
            tree["at_in"] = (round(x, 1), round(y, 1))
            tree["band"] = band["name"]
            tree["branches"] = []
            placed.append((x, y, tree["canopy_in"]))
            out.append(tree)
            got += 1
    return out
