import math
import random

from . import house, route, yard

NEAR_REACH_IN = 900
NEAR_STEP_IN = 5.0
FAR_STEP_IN = 16.0
RAMP_IN = 2400.0
RAMP_POWER = 1.8
BACK_BOOST = 1.8
LOW_IN = 2.0
HIGH_IN = 20.0
CAP_IN = 24.0
THATCH_IN = (500.0, 1100.0)
THATCH_SLANT = (1.15, 0.35)
THATCH_CAP_IN = 7.0
CLUMP_FROM_IN = 600.0
CLUMP_SHARE = 0.05
CLUMP_GROWTH = (1.5, 2.0)
LANE_HEIGHT_IN = 4.0
TONES = 7
GREEN = 6
THIN_BELOW = -0.45
BARE_BELOW = -0.75
GREEN_ABOVE = 0.93
BLADES = 7
WALK_MARGIN_IN = route.WALK_CLEAR_IN
HAZARD_MARGIN_IN = route.HAZARD_CLEAR_IN


def keep_out(spec):
    rects = [tuple(s["min_in"]) + tuple(s["max_in"]) for s in spec["structures"]]
    rects += [(b[0] - HAZARD_MARGIN_IN, b[1] - HAZARD_MARGIN_IN, b[3] + HAZARD_MARGIN_IN, b[4] + HAZARD_MARGIN_IN)
              for b in route.hazard_boxes(spec).values()]
    return rects


def walk_lanes(spec):
    rects = []
    for o in house.loop(spec, route.params(spec)["standoff_in"]):
        (sx, sy), (ex, ey) = o["start"], o["end"]
        rects.append((min(sx, ex) - WALK_MARGIN_IN, min(sy, ey) - WALK_MARGIN_IN, max(sx, ex) + WALK_MARGIN_IN, max(sy, ey) + WALK_MARGIN_IN))
    return rects


def _density(px, py):
    return (math.sin(px / 170.0 + 2.0 * math.sin(py / 310.0)) + math.sin(py / 140.0 + 2.0 * math.sin(px / 260.0))) / 2.0


def _greenness(px, py):
    return math.sin(px / 90.0 + 2.0 * math.sin(py / 170.0)) * math.sin(py / 110.0 + 1.7 * math.sin(px / 150.0))


def _keep(density, rng):
    if density >= THIN_BELOW:
        return True
    return rng.random() < max(0.0, (density - BARE_BELOW) / (THIN_BELOW - BARE_BELOW)) * 0.4


def _field(spec, rng, lo, hi, step):
    (x0, y0), (x1, y1) = spec["lot"]["min_in"], spec["lot"]["max_in"]
    rects, lanes, eds = keep_out(spec), walk_lanes(spec), house.edges(spec)
    hole = (min(e["start"][0] for e in eds), min(e["start"][1] for e in eds), max(e["start"][0] for e in eds), max(e["start"][1] for e in eds))
    out = []
    x = max(lo[0], x0)
    while x < min(hi[0], x1):
        y = max(lo[1], y0)
        while y < min(hi[1], y1):
            px, py = round(x + rng.uniform(0, step), 1), round(y + rng.uniform(0, step), 1)
            y += step
            if not (x0 <= px <= x1 and y0 <= py <= y1) or house.overlaps_house((px, py, px, py), eds):
                continue
            if any(r[0] <= px <= r[2] and r[1] <= py <= r[3] for r in rects) or yard.contains(spec, px, py):
                continue
            density = _density(px, py)
            if not _keep(density, rng):
                continue
            reach = math.hypot(max(hole[0] - px, 0.0, px - hole[2]), max(hole[1] - py, 0.0, py - hole[3]))
            true_reach = reach
            if py > hole[3]:
                reach *= BACK_BOOST
            base = LOW_IN + (HIGH_IN - LOW_IN) * min(1.0, reach / RAMP_IN) ** RAMP_POWER
            tall = base * rng.uniform(0.45, 1.55) * (0.75 + 0.5 * (0.5 + 0.5 * density))
            if true_reach > CLUMP_FROM_IN and rng.random() < CLUMP_SHARE:
                tall *= rng.uniform(*CLUMP_GROWTH)
            tall = min(tall, CAP_IN, THATCH_CAP_IN if true_reach < THATCH_IN[0] else CAP_IN)
            lean = rng.uniform(0, 2 * math.pi)
            if any(r[0] <= px <= r[2] and r[1] <= py <= r[3] for r in lanes):
                tall = min(tall, LANE_HEIGHT_IN)
            flat = min(1.0, max(0.0, (THATCH_IN[1] - true_reach) / (THATCH_IN[1] - THATCH_IN[0])))
            slant = THATCH_SLANT[1] + (THATCH_SLANT[0] - THATCH_SLANT[1]) * flat
            tone = GREEN if _greenness(px, py) > GREEN_ABOVE else rng.randrange(GREEN)
            out.append({"at_in": (px, py), "tall_in": round(tall, 1),
                        "lean": (round(math.cos(lean) * tall * slant, 1), round(math.sin(lean) * tall * slant, 1)),
                        "tone": tone, "blades": BLADES})
        x += step
    return out


def tufts(spec):
    rng = random.Random(spec["id"] + " meadow")
    eds = house.edges(spec)
    xs, ys = [e["start"][0] for e in eds], [e["start"][1] for e in eds]
    lo, hi = (min(xs) - NEAR_REACH_IN, min(ys) - NEAR_REACH_IN), (max(xs) + NEAR_REACH_IN, max(ys) + NEAR_REACH_IN)
    out = _field(spec, rng, lo, hi, NEAR_STEP_IN)
    far = _field(spec, rng, (-1e9, -1e9), (1e9, 1e9), FAR_STEP_IN)
    out += [t for t in far if not (lo[0] <= t["at_in"][0] <= hi[0] and lo[1] <= t["at_in"][1] <= hi[1])]
    return out
