import math
import random

from . import geom, house, motion

DEFAULTS = {
    "standoff_in": 132,
    "height_in": 54,
    "tilt_deg": 12,
    "pan_tilt_deg": 3,
    "speed_in_s": 30,
    "pan_s": 12,
    "fps": 30,
    "width_px": 1920,
    "height_px": 1080,
    "focal_mm": 26,
    "sensor_width_mm": 36,
}
PAN_S = (10, 20)
MAX_S = 330
MAX_TURN_DEG = 15
EASE_S = 0.75
TURN_IN = 36
PAN_TURN_S = 2
SWEEP_DEG = {"side": 45, "corner": 60}
WALKABLE = ("porch", "deck", "landing")
PARTS = "emberwalk.route-parts/1"
TUFT_TRIES = 16000
TUFT_IN = 12.0
TUFT_REACH_IN = 600
TUFT_BLADES = 8
TUFT_HEIGHT_IN = (4.0, 11.0)
BLADE_IN = 0.6
WALK_CLEAR_IN = 30
HAZARD_CLEAR_IN = 6
CONVENTIONS = {
    "pos_in": "inches in house axes: x east, y north, z up from the ground, origin at the south west corner of the footprint's bounding box",
    "heading_deg": "compass bearing about z: 0 looks north, 90 east, 180 south, 270 west",
    "tilt_deg": "degrees below the horizon",
    "roll_deg": "turn about the view axis, positive when the top of the phone turns right as the holder sees it",
    "t": "seconds from the first frame",
}


def params(spec):
    p = dict(DEFAULTS)
    for key, value in spec["route"].items():
        if key == "placeholder":
            continue
        if key not in DEFAULTS:
            raise house.HouseError("refused", "route: unknown setting %s" % key)
        p[key] = value
    if not PAN_S[0] <= p["pan_s"] <= PAN_S[1]:
        raise house.HouseError("refused", "route: pan %s s is outside %d to %d s" % (p["pan_s"], PAN_S[0], PAN_S[1]))
    return p


def stride_in(p):
    return 2.0 * p["speed_in_s"] / motion.STEP_HZ


def _smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _heading(edge):
    return house._bearing((-edge["n"][0], -edge["n"][1]))


def _path(spec, standoff):
    ring = house.loop(spec, standoff)
    n = len(ring)
    f = next(i for i, e in enumerate(ring) if e["side"] == "front")
    door = tuple(house.door_point(spec, standoff))
    edges = [ring[(f + k) % n] for k in range(n)] + [ring[f]]
    pts = [door] + [tuple(e["end"]) for e in edges[:-1]] + [door]
    s = [0.0]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + math.dist(a, b))
    return {"pts": pts, "s": s, "edges": edges}


def _corners(path):
    s, eds = path["s"], path["edges"]
    out = []
    for k in range(1, len(eds)):
        t = (_heading(eds[k]) - _heading(eds[k - 1]) + 180) % 360 - 180
        r = min(TURN_IN, (s[k] - s[k - 1]) / 2.0, (s[k + 1] - s[k]) / 2.0)
        out.append((s[k], t, max(r, 1e-6)))
    return out


def _wall_heading(path, corners, at):
    return _heading(path["edges"][0]) + sum(t * _smooth((at - sk + r) / (2 * r)) for sk, t, r in corners)


def _locate(path, at):
    pts, s = path["pts"], path["s"]
    j = max(0, min(len(pts) - 2, next((i for i in range(len(pts) - 1) if at <= s[i + 1]), len(pts) - 2)))
    a, b = pts[j], pts[j + 1]
    k = 0.0 if s[j + 1] == s[j] else (at - s[j]) / (s[j + 1] - s[j])
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k), path["edges"][j]


def _stop_s(path, point, after):
    pts, s = path["pts"], path["s"]
    for j in range(len(pts) - 1):
        a, b = pts[j], pts[j + 1]
        on = min(a[0], b[0]) - 1e-6 <= point[0] <= max(a[0], b[0]) + 1e-6 and min(a[1], b[1]) - 1e-6 <= point[1] <= max(a[1], b[1]) + 1e-6
        if on and s[j] + math.dist(a, point) >= after - 1e-6:
            return s[j] + math.dist(a, point)
    raise house.HouseError("refused", "route: pan at %s is not on the walk" % (point,))


def _surface(spec, path, stride):
    spans = []
    for st in spec["structures"]:
        if st["kind"] not in WALKABLE:
            continue
        (x0, y0), (x1, y1) = st["min_in"], st["max_in"]
        for j, (a, b) in enumerate(zip(path["pts"], path["pts"][1:])):
            if a[1] == b[1] and y0 < a[1] < y1:
                lo, hi, c0 = max(x0, min(a[0], b[0])), min(x1, max(a[0], b[0])), a[0]
            elif a[0] == b[0] and x0 < a[0] < x1:
                lo, hi, c0 = max(y0, min(a[1], b[1])), min(y1, max(a[1], b[1])), a[1]
            else:
                continue
            if lo < hi:
                ends = sorted(path["s"][j] + abs(v - c0) for v in (lo, hi))
                spans.append([ends[0], ends[1], st["height_in"]])
    spans.sort()
    merged = []
    for sp in spans:
        if merged and sp[0] - merged[-1][1] < 1e-6 and sp[2] == merged[-1][2]:
            merged[-1][1] = max(merged[-1][1], sp[1])
        else:
            merged.append(sp)
    half = stride / 2.0
    return lambda at: max([h * _smooth((at - lo + half) / stride) * (1 - _smooth((at - hi + half) / stride)) for lo, hi, h in merged] + [0.0])


def _walk_at(tau, dur, dist):
    ease = min(EASE_S, dur / 2.0)
    top = dist / (dur - ease)
    start = min(tau, ease)
    late = max(0.0, tau - dur + ease)
    return top * (tau - start + start * start / (2 * ease) - late * late / (2 * ease)), min(1.0, tau / ease, (dur - tau) / ease)


def _pan_at(tau, p, kind):
    sweep_s, a = p["pan_s"] - 2 * PAN_TURN_S, SWEEP_DEG[kind]
    if tau < PAN_TURN_S:
        k = _smooth(tau / PAN_TURN_S)
        return (180 - a) * k, k
    if tau < PAN_TURN_S + sweep_s:
        return 180 - a + 2 * a * _smooth((tau - PAN_TURN_S) / sweep_s), 1.0
    k = _smooth((tau - PAN_TURN_S - sweep_s) / PAN_TURN_S)
    return 180 + a + (180 - a) * k, 1 - k


def hazard_boxes(spec):
    by_side = {e["side"]: e for e in house.edges(spec)}
    out = {}
    for h in spec["hazards"] + spec.get("fixed", []):
        x0, y0, x1, y1 = house.plan_rect(by_side[h["side"]], h["along_in"], h["distance_in"], h["size_in"][0], h["size_in"][1])
        z0 = h.get("elevation_in", 0)
        out[h["id"]] = (x0, y0, z0, x1, y1, z0 + h["size_in"][2])
    return out


def ground_cover(spec):
    eds = house.edges(spec)
    clear = WALK_CLEAR_IN
    keep_out = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in spec["structures"]]
    keep_out += [(b[0] - HAZARD_CLEAR_IN, b[1] - HAZARD_CLEAR_IN, b[3] + HAZARD_CLEAR_IN, b[4] + HAZARD_CLEAR_IN) for b in hazard_boxes(spec).values()]
    for o in house.loop(spec, params(spec)["standoff_in"]):
        (sx, sy), (ex, ey) = o["start"], o["end"]
        keep_out.append((min(sx, ex) - clear, min(sy, ey) - clear, max(sx, ex) + clear, max(sy, ey) + clear))
    xs, ys = [e["start"][0] for e in eds], [e["start"][1] for e in eds]
    rng = random.Random(spec["id"] + " ground cover")
    tufts = []
    for _ in range(TUFT_TRIES):
        x = rng.uniform(min(xs) - TUFT_REACH_IN, max(xs) + TUFT_REACH_IN - TUFT_IN)
        y = rng.uniform(min(ys) - TUFT_REACH_IN, max(ys) + TUFT_REACH_IN - TUFT_IN)
        spot = (x, y, x + TUFT_IN, y + TUFT_IN)
        if house.overlaps_house(spot, eds) or not house._in_lot(spot, spec["lot"]) or any(house._overlap(spot, r) for r in keep_out):
            continue
        tall, blades = rng.uniform(*TUFT_HEIGHT_IN), []
        for _ in range(TUFT_BLADES):
            bx, by = x + rng.uniform(0, TUFT_IN / 2.0), y + rng.uniform(0, TUFT_IN / 2.0)
            tip = (bx + rng.uniform(0, TUFT_IN / 2.0), by + rng.uniform(0, TUFT_IN / 2.0), tall * rng.uniform(0.6, 1.0))
            blades.append([(bx, by, 0), (bx + BLADE_IN, by, 0), tip])
        tufts.append({"at_in": (x, y), "tall_in": tall, "blades": blades})
    return tufts


def _timeline(spec, p, path):
    stops = []
    after = 0.0
    for pan in house.pans(spec, p["standoff_in"]):
        after = _stop_s(path, pan["at_in"], after)
        stops.append((after, pan))
    events, t, at = [], 0.0, 0.0
    for stop_s, pan in stops + [(path["s"][-1], None)]:
        if stop_s - at > 1e-6:
            dur = (stop_s - at) / p["speed_in_s"] + EASE_S
            events.append({"kind": "loop", "t0": t, "t1": t + dur, "s0": at, "s1": stop_s})
            t += dur
        at = stop_s
        if pan is not None:
            events.append({"kind": "pan", "t0": t, "t1": t + p["pan_s"], "s0": at, "pan": pan})
            t += p["pan_s"]
    return events, t


def _pose(i, p, path, corners, surface, events, turns):
    t = i / float(p["fps"])
    k = next((j for j, e in enumerate(events) if t < e["t1"]), len(events) - 1)
    e = events[k]
    spun = 360.0 * turns[k]
    tilt = p["tilt_deg"]
    if e["kind"] == "loop":
        d, gait = _walk_at(min(t - e["t0"], e["t1"] - e["t0"]), e["t1"] - e["t0"], e["s1"] - e["s0"])
        at = e["s0"] + d
        heading = _wall_heading(path, corners, at) + spun
    else:
        at, gait = e["s0"], 0.0
        swing, out = _pan_at(t - e["t0"], p, e["pan"]["kind"])
        heading = _wall_heading(path, corners, at) + spun + swing
        tilt += (p["pan_tilt_deg"] - p["tilt_deg"]) * out
    (x, y), edge = _locate(path, at)
    sway = 0.5 * gait * motion._wave(t, motion.STEP_HZ / 2)
    heading += 1.2 * motion._wave(t, 0.23) + 0.5 * motion._wave(t, 0.71, 1.0) + 0.3 * gait * motion._wave(t, motion.STEP_HZ / 2)
    tilt += 0.9 * motion._wave(t, 0.31, 0.5) + 0.35 * gait * motion._wave(t, motion.STEP_HZ, 0.8)
    roll = 0.7 * motion._wave(t, 0.4, 2.0) + 0.3 * gait * motion._wave(t, motion.STEP_HZ / 2, 0.3)
    z = p["height_in"] + surface(at) + 0.75 * gait * motion._wave(t, motion.STEP_HZ)
    return {
        "frame": i + 1,
        "t": round(t, 6),
        "pos_in": [round(x + edge["n"][0] * sway, 2), round(y + edge["n"][1] * sway, 2), round(z, 2)],
        "heading_deg": round(heading % 360, 3) % 360,
        "tilt_deg": round(tilt, 3),
        "roll_deg": round(roll, 3),
    }


def check_samples(spec, samples):
    eds = house.edges(spec)
    boxes = hazard_boxes(spec)
    for s in samples:
        x, y, z = s["pos_in"]
        if house.overlaps_house((x - 1, y - 1, x + 1, y + 1), eds):
            raise house.HouseError("refused", "route: the camera enters the house at frame %d" % s["frame"])
        for hid, (x0, y0, z0, x1, y1, z1) in sorted(boxes.items()):
            if x0 < x < x1 and y0 < y < y1 and z0 < z < z1:
                raise house.HouseError("refused", "route: the camera enters %s at frame %d" % (hid, s["frame"]))
    for a, b in zip(samples, samples[1:]):
        if abs((b["heading_deg"] - a["heading_deg"] + 180) % 360 - 180) > MAX_TURN_DEG:
            raise house.HouseError("refused", "route: the heading jumps more than %d degrees at frame %d" % (MAX_TURN_DEG, b["frame"]))


def _part(e, fps):
    out = {"kind": e["kind"]}
    if e["kind"] == "loop":
        out["loop_in"] = [round(e["s0"], 6), round(e["s1"], 6)]
    else:
        pan = e["pan"]
        out.update({"side": pan["side"]} if pan["kind"] == "side" else {"corner": pan["sides"]})
        out["bearing_deg"] = pan["bearing_deg"]
    out.update(start_s=round(e["t0"], 6), end_s=round(e["t1"], 6), start_frame=round(e["t0"] * fps) + 1, end_frame=round(e["t1"] * fps))
    return out


def build(spec):
    p = params(spec)
    path = _path(spec, p["standoff_in"])
    events, total = _timeline(spec, p, path)
    if total > MAX_S:
        raise house.HouseError("refused", "route: the walk runs %.1f s, over %d s" % (total, MAX_S))
    corners = _corners(path)
    surface = _surface(spec, path, stride_in(p))
    turns = [sum(1 for x in events[:j] if x["kind"] == "pan") for j in range(len(events))]
    n = int(math.ceil(total * p["fps"] - 1e-9))
    samples = [_pose(i, p, path, corners, surface, events, turns) for i in range(n)]
    check_samples(spec, samples)
    camera = {k: p[k] for k in ("width_px", "height_px", "focal_mm", "sensor_width_mm")}
    hfov, vfov = geom.fov_deg(camera)
    camera.update(sensor_fit="horizontal", hfov_deg=round(hfov, 3), vfov_deg=round(vfov, 3))
    head = {"synthetic": True, "label": spec["label"], "scene": spec["id"], "fps": p["fps"], "frame_count": n, "duration_s": n / float(p["fps"])}
    parts = [_part(e, p["fps"]) for e in events]
    parts[-1]["end_frame"] = n
    motion_doc = dict(head, schema="emberwalk.motion/1", camera=camera, conventions=CONVENTIONS, samples=samples)
    motion_doc = {k: motion_doc[k] for k in ("schema", "synthetic", "label", "scene", "fps", "frame_count", "duration_s", "camera", "conventions", "samples")}
    parts_doc = dict({"schema": PARTS}, **head, standoff_in=p["standoff_in"], parts=parts)
    return motion_doc, parts_doc
