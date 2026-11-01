import math

from . import house

ROOF_THICK_IN = 6
GUTTER_TALL_IN = 5
GUTTER_FLOOR_IN = (0.6, 1.7)
PIPE_ALONG_IN = 3.0
PIPE_DEEP_IN = 2.0
WALL_O_IN = 1.0
OUTLET_UP_IN = 0.5
DROP_IN = 4.0
KICK_IN = 5.0
GROUND_CLEAR_IN = 6.0
RUN_END_IN = PIPE_ALONG_IN / 2.0 + 0.5
OPENING_MARGIN_IN = 3.5
SAMPLE_IN = 0.1


def _wall_point(e, a, o, z):
    return (e["start"][0] + e["u"][0] * a + e["n"][0] * o, e["start"][1] + e["u"][1] * a + e["n"][1] * o, z)


def inside_roof(prisms, p):
    """The index of the first roof slab the point sits inside, or None."""
    for i, q in enumerate(prisms):
        axis = 1 if q["ridge"] == "east_west" else 0
        if not (q["lo"][0] < p[0] < q["hi"][0] and q["lo"][1] < p[1] < q["hi"][1]):
            continue
        half = (q["hi"][axis] - q["lo"][axis]) / 2.0
        top = q["eave_z_in"] + min(p[axis] - q["lo"][axis], q["hi"][axis] - p[axis]) * (q["ridge_z_in"] - q["eave_z_in"]) / half
        if top - ROOF_THICK_IN < p[2] < top:
            return i
    return None


def _run_over(e, along, eave, runs):
    k = 0 if e["facing"] in ("east", "west") else 1
    r = 1 - k
    at = e["start"][r] + e["u"][r] * along
    for g in runs:
        if g["facing"] != e["facing"] or g["start"][k] != e["start"][k] + e["n"][k] * eave:
            continue
        lo, hi = sorted((g["start"][r], g["end"][r]))
        if lo + RUN_END_IN <= at <= hi - RUN_END_IN:
            return g
    return None


def _path(eave, floor_z, ground):
    out = eave + (GUTTER_FLOOR_IN[0] + eave - GUTTER_FLOOR_IN[1]) / 2.0
    top = floor_z + OUTLET_UP_IN
    elbow = top - DROP_IN - (out - WALL_O_IN)
    foot = ground + GROUND_CLEAR_IN + PIPE_DEEP_IN / 2.0 * math.sqrt(0.5)
    pts = [(out, top), (out, top - DROP_IN), (WALL_O_IN, elbow), (WALL_O_IN, foot + KICK_IN), (WALL_O_IN + KICK_IN, foot)]
    return pts


def _rings(e, along, pts):
    segs = []
    for (o0, z0), (o1, z1) in zip(pts, pts[1:]):
        n = math.hypot(o1 - o0, z1 - z0)
        segs.append((-(z1 - z0) / n, (o1 - o0) / n))
    rings = []
    for i, (o, z) in enumerate(pts):
        if i == 0 or i == len(pts) - 1:
            nx, nz = segs[0 if i == 0 else -1]
            scale = 1.0
        else:
            sx, sz = segs[i - 1][0] + segs[i][0], segs[i - 1][1] + segs[i][1]
            length = math.hypot(sx, sz)
            nx, nz = sx / length, sz / length
            scale = 1.0 / (nx * segs[i - 1][0] + nz * segs[i - 1][1])
        h = PIPE_DEEP_IN / 2.0 * scale
        ring = []
        for su, sn in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            ring.append(_wall_point(e, along + su * PIPE_ALONG_IN / 2.0, o + sn * h * nx, z + sn * h * nz))
        rings.append(ring)
    return rings


def samples(rings):
    out = []
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            p, q = a[k], b[k]
            steps = max(1, int(math.dist(p, q) / SAMPLE_IN))
            out += [tuple(p[c] + (q[c] - p[c]) * s / steps for c in range(3)) for s in range(steps + 1)]
    return out


def _blockers(doc):
    features = doc["house"]["features"]
    m = OPENING_MARGIN_IN
    out = [(key, doc[key]["side"], doc[key]["along_in"], doc[key]["along_in"] + doc[key]["width_in"], 0, math.inf) for key in ("front_door", "back_door") if key in doc]
    g = features.get("garage_door")
    if g:
        out.append(("garage_door", g["side"], g["along_in"], g["along_in"] + g["width_in"], 0, g["height_in"]))
    for w in features.get("windows", []):
        out.append(("windows", w["side"], w["along_in"], w["along_in"] + w["width_in"], w["sill_in"] - m, w["sill_in"] + w["height_in"] + m))
    c = features.get("chimney")
    if c:
        out.append(("chimney", c["side"], c["along_in"], c["along_in"] + c["size_in"][0], 0, math.inf))
    for v in features["foundation_vents"]:
        out.append(("foundation_vents", v["side"], v["along_in"], v["along_in"] + v["width_in"], 0, v["elevation_in"] + v["height_in"] + m))
    return [(name, side, a0 - m, a1 + m, z0, z1) for name, side, a0, a1, z0, z1 in out]


def _ground(doc, e, along):
    rect = house.plan_rect(e, along - PIPE_ALONG_IN / 2.0, 0, PIPE_ALONG_IN, WALL_O_IN + PIPE_DEEP_IN / 2.0 + KICK_IN)
    return max([s["height_in"] for s in doc["structures"] if s["kind"] in house.STEPPED and house._overlap(rect, tuple(s["min_in"]) + tuple(s["max_in"]))] + [0])


def plan(doc, prisms=None):
    """The pipes the spec asks for, each as its centre line points (out from the wall, up) and the four-cornered rings of its tube in house inches."""
    features = doc["house"]["features"]
    asked = features.get("downspouts", [])
    if not asked:
        return []
    if not features["gutters"]:
        raise house.HouseError("refused", "downspouts: the house has no gutters to drain")
    prisms = house.roof_prisms(doc) if prisms is None else prisms
    eds = {e["side"]: e for e in house.edges(doc)}
    runs, eave, blockers = house.gutter_runs(doc), doc["house"]["roof"]["eave_in"], _blockers(doc)
    out = []
    for i, d in enumerate(asked):
        where = "downspouts[%d] %s at %d in" % (i, d["side"], d["along_in"])
        e = eds.get(d["side"])
        if e is None:
            raise house.HouseError("refused", "%s: side %s is not in the house" % (where, d["side"]))
        along, half = d["along_in"], PIPE_ALONG_IN / 2.0
        if along - half < 0 or along + half > e["length_in"]:
            raise house.HouseError("refused", "%s: the pipe runs past the wall end at %d in" % (where, e["length_in"]))
        run = _run_over(e, along, eave, runs)
        if run is None:
            raise house.HouseError("refused", "%s: no gutter run lies over that wall point with room for the pipe" % where)
        ground = _ground(doc, e, along)
        pts = _path(eave, run["z_in"] - GUTTER_TALL_IN, ground)
        if pts[2][1] - pts[3][1] < 12:
            raise house.HouseError("refused", "%s: the wall is too short for a drop" % where)
        for name, side, a0, a1, z0, z1 in blockers:
            if side == d["side"] and a0 < along + half and along - half < a1 and z0 < pts[2][1] and pts[3][1] < z1:
                raise house.HouseError("refused", "%s: the drop crosses the %s on that wall" % (where, name))
        rings = _rings(e, along, pts)
        for p in samples(rings):
            hit = inside_roof(prisms, p)
            if hit is not None:
                raise house.HouseError("refused", "%s: the drop would cross roof %d at (%.0f, %.0f, %.0f)" % (where, hit + 1, p[0], p[1], p[2]))
        out.append({"side": d["side"], "along_in": along, "points": pts, "rings": rings, "ground_in": ground, "gutter_z_in": run["z_in"]})
    return out
