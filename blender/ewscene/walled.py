"""The walled house: the hero house with its right side yard closed by a block wall and two wood fences.

The walk starts facing the wall, backs off to the front, goes round the front, the left side and the back on the hero's
own poses, and ends facing the back fence. The right side is never walked, so its hazards are expected not measured.
"""
import json

SCENE = "hero-walled"
BLOCKED_SIDE = "right"
OBSTACLES = [
    {"id": "side-yard-wall", "kind": "block_wall", "min_in": [720, 320, 0], "max_in": [1204, 328, 72]},
    {"id": "back-fence-east", "kind": "wood_fence", "min_in": [720, 780, 0], "max_in": [1204, 784, 72]},
    {"id": "lot-line-fence-east", "kind": "wood_fence", "min_in": [1200, 328, 0], "max_in": [1204, 780, 72]},
]
CLEARANCE_IN = 24
MAX_TURN_DEG = 1.7
MAX_STEP_IN = 6.0
# The pipeline's side of the camera, packages/sample-import/src/live/route-tags.ts sideOfCamera.
LEFT_OF_IN, BEHIND_IN, RIGHT_OF_IN = -50, 850, 800
FRONT_MARGIN_IN = 10
WALL_GAP_IN = 72
HOLD_FRAMES = 30
BACK_OFF_FRAMES = 240
JOIN_TURN_FRAMES = 48
END_TURN_FRAMES = 90
END_HEADING = 180.0


def camera_side(pos):
    x, y = pos[0], pos[1]
    if x < LEFT_OF_IN:
        return "left"
    if y > BEHIND_IN:
        return "back"
    if x > RIGHT_OF_IN:
        return "right"
    return "front"


def turn(a, b):
    return (b - a + 180) % 360 - 180


def clearance(pos):
    """Inches from the camera to the nearest obstacle, on the ground plan."""
    best = None
    for o in OBSTACLES:
        dx = max(o["min_in"][0] - pos[0], 0, pos[0] - o["max_in"][0])
        dy = max(o["min_in"][1] - pos[1], 0, pos[1] - o["max_in"][1])
        d = (dx * dx + dy * dy) ** 0.5
        best = d if best is None else min(best, d)
    return best


def _ease(u):
    return u * u * (3 - 2 * u)


def _pose(base, pos, heading):
    s = dict(base)
    s["pos_in"] = [round(v, 3) for v in pos]
    s["heading_deg"] = round(heading % 360, 4)
    return s


def _cut(samples):
    right = [i for i, s in enumerate(samples) if camera_side(s["pos_in"]) == "right"]
    if not right:
        raise ValueError("the hero walk never reaches the right side")
    first = next(i for i in range(right[-1] + 1, len(samples)) if samples[i]["pos_in"][0] <= RIGHT_OF_IN - FRONT_MARGIN_IN)
    last = right[0] - 1
    while samples[last]["pos_in"][1] <= BEHIND_IN + FRONT_MARGIN_IN:
        last -= 1
    return first, last


def build(hero, hero_parts):
    """Returns (motion, parts) for the walled walk from the hero's steady motion and parts."""
    hs = hero["samples"]
    first, last = _cut(hs)
    start = hs[first]
    wall = next(o for o in OBSTACLES if o["id"] == "side-yard-wall")
    at_wall = [start["pos_in"][0], wall["min_in"][1] - WALL_GAP_IN, start["pos_in"][2]]
    rows = []  # (sample, hero frame or None)
    rows += [(_pose(start, at_wall, 0.0), None) for _ in range(HOLD_FRAMES)]
    for i in range(BACK_OFF_FRAMES):
        u = _ease(i / BACK_OFF_FRAMES)
        pos = [a + (b - a) * u for a, b in zip(at_wall, start["pos_in"])]
        rows.append((_pose(start, pos, turn(0.0, start["heading_deg"]) * u), None))
    rows += [(s, s["frame"]) for s in hs[first:]]
    a, b = hs[-1], hs[0]
    if sum((p - q) ** 2 for p, q in zip(a["pos_in"], b["pos_in"])) ** 0.5 > 1.0:
        raise ValueError("the hero lap does not end where it starts")
    swing = turn(a["heading_deg"], b["heading_deg"])
    rows += [(_pose(a, a["pos_in"], a["heading_deg"] + swing * _ease((i + 1) / (JOIN_TURN_FRAMES + 1))), None) for i in range(JOIN_TURN_FRAMES)]
    rows += [(s, s["frame"]) for s in hs[:last + 1]]
    end = hs[last]
    swing = turn(end["heading_deg"], END_HEADING)
    rows += [(_pose(end, end["pos_in"], end["heading_deg"] + swing * _ease((i + 1) / END_TURN_FRAMES)), None) for i in range(END_TURN_FRAMES)]
    rows += [(_pose(end, end["pos_in"], END_HEADING), None) for _ in range(HOLD_FRAMES)]

    fps = hero["fps"]
    samples = []
    for n, (s, _) in enumerate(rows, start=1):
        s = dict(s)
        s["frame"] = n
        s["t"] = round((n - 1) / fps, 6)
        samples.append(s)
    count = len(samples)
    motion = {k: v for k, v in hero.items() if k != "samples"}
    motion.update(scene=SCENE, frame_count=count, duration_s=round(count / fps, 3), samples=samples)
    check(motion)
    return motion, _parts(hero_parts, rows, samples, fps)


def _part_of(hero_parts, frame):
    if frame is None:
        return None
    return next(p for p in hero_parts["parts"] if p["start_frame"] <= frame <= p["end_frame"])


def _parts(hero_parts, rows, samples, fps):
    keys = []
    for _, frame in rows:
        p = _part_of(hero_parts, frame)
        keys.append(("walk", None, None) if p is None or p["kind"] != "pan" else ("pan", p["side"], p["bearing_deg"]))
    walked = [0.0]
    for a, b in zip(samples, samples[1:]):
        walked.append(walked[-1] + sum((p - q) ** 2 for p, q in zip(a["pos_in"][:2], b["pos_in"][:2])) ** 0.5)
    out = []
    start = 0
    for i in range(1, len(keys) + 1):
        if i < len(keys) and keys[i] == keys[start]:
            continue
        kind, side, bearing = keys[start]
        part = {"kind": kind}
        if kind == "pan":
            part.update(side=side, bearing_deg=bearing)
        else:
            part["loop_in"] = [round(walked[start], 1), round(walked[i - 1], 1)]
        part.update(start_s=round(start / fps, 3), end_s=round(i / fps, 3), start_frame=start + 1, end_frame=i)
        out.append(part)
        start = i
    count = len(samples)
    doc = {k: v for k, v in hero_parts.items() if k != "parts"}
    doc.update(scene=SCENE, frame_count=count, duration_s=round(count / fps, 3), parts=out)
    return doc


def sources(motion, hero):
    """The hero frame each walled frame copies, None for a pose made here."""
    first, last = _cut(hero["samples"])
    count = len(hero["samples"])
    out = [None] * (HOLD_FRAMES + BACK_OFF_FRAMES) + list(range(first + 1, count + 1)) + [None] * JOIN_TURN_FRAMES
    out += list(range(1, last + 2)) + [None] * (END_TURN_FRAMES + HOLD_FRAMES)
    if len(out) != motion["frame_count"]:
        raise ValueError("the walled walk was not made from this hero walk")
    return out


def carry_boxes(h, source, samples):
    """A hazard with no mask in the walled scene keeps the hero's boxes on the walled frames that copy a hero pose."""
    from .truth import _windows
    by_hero = {b["frame"]: b for b in h.get("frame_boxes", [])}
    rows = [(n, by_hero[f]) for n, f in enumerate(source, start=1) if f in by_hero]
    out = dict(h)
    out["frame_boxes"] = [{"frame": n, "t": samples[n - 1]["t"], "box_px": b["box_px"], "area_px": b["area_px"]} for n, b in rows]
    out["visible_frames"] = len(rows)
    out["visible_s"] = _windows([n - 1 for n, _ in rows], samples)
    return out


def check(motion):
    """Refuses a walk that reaches the right side, comes within the clearance of an obstacle, turns or steps too fast."""
    s = motion["samples"]
    for x in s:
        if camera_side(x["pos_in"]) == BLOCKED_SIDE:
            raise ValueError("frame %d stands on the %s side" % (x["frame"], BLOCKED_SIDE))
        if clearance(x["pos_in"]) < CLEARANCE_IN:
            raise ValueError("frame %d is within %d in of the wall or a fence" % (x["frame"], CLEARANCE_IN))
    for a, b in zip(s, s[1:]):
        if abs(turn(a["heading_deg"], b["heading_deg"])) >= MAX_TURN_DEG:
            raise ValueError("frame %d turns too fast" % b["frame"])
        if sum((p - q) ** 2 for p, q in zip(a["pos_in"], b["pos_in"])) ** 0.5 > MAX_STEP_IN:
            raise ValueError("frame %d steps too far" % b["frame"])


def _house_point(footprint, side, along, out):
    starts = [f["start_in"] for f in footprint]
    i = next(k for k, f in enumerate(footprint) if f["side"] == side)
    (x0, y0), (x1, y1) = starts[i], starts[(i + 1) % len(starts)]
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    return x0 + ux * along - uy * out, y0 + uy * along + ux * out


def in_walled_yard(footprint, side, box):
    """True when the box's centre stands in the yard the wall and fences close off."""
    x, y = _house_point(footprint, side, (box["min"][0] + box["max"][0]) / 2, (box["min"][1] + box["max"][1]) / 2)
    wall, back, lot = (next(o for o in OBSTACLES if o["id"] == k) for k in ("side-yard-wall", "back-fence-east", "lot-line-fence-east"))
    return wall["min_in"][0] < x < lot["min_in"][0] and wall["max_in"][1] < y < back["min_in"][1]


def mark_truth(doc, spec_sides):
    """The hero's answer key for the walled house: every hazard kept, those in the walled yard expected not measured.
    spec_sides names each hazard's own wall from the spec, since the key files some under the side the app reads."""
    out = json.loads(json.dumps(doc))
    out["scene"] = SCENE
    out["not_measured_sides"] = [{"side": BLOCKED_SIDE, "blocked_by": [o["id"] for o in OBSTACLES]}]
    for h in out["hazards"]:
        h["measured"] = not in_walled_yard(out["footprint"], spec_sides.get(h["id"], h["side"]), h["box_in"])
    return out
