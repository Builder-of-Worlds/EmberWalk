import copy
import json

from . import finalshots, truth

# Sideways offsets in metres, house axes, eased between keys; headings and heights are never touched.
DX = (
    (2020, 0.0), (2200, 2.6), (2290, 2.6), (2380, 1.6), (2440, 1.6), (2520, 2.2), (2660, 2.2), (2830, 0.0),
    (4300, 0.0), (4540, 3.9), (4660, 3.9), (4780, 2.7), (5150, 2.7), (5320, -0.9), (5500, -0.9), (5660, 0.0),
)
DY = (
    (2020, 0.0), (2830, 0.0),
    (4300, 0.0), (4580, 0.0), (4780, -1.1), (5150, -1.1), (5320, 2.2), (5660, 0.0),
)
WINDOWS = ((2020, 2830), (4300, 5660))
M_TO_IN = 1.0 / finalshots.IN_TO_M


def ease(keys, frame):
    if frame <= keys[0][0]:
        return 0.0
    for (a, va), (b, vb) in zip(keys, keys[1:]):
        if a <= frame <= b:
            u = (frame - a) / float(b - a)
            return va + (vb - va) * u * u * (3 - 2 * u)
    return 0.0


def offset_m(frame):
    return ease(DX, frame), ease(DY, frame)


def apply(samples):
    """A copy of the samples with positions shifted by the detour; every other field is the sample's own."""
    out = copy.deepcopy(samples)
    for s in out:
        dx, dy = offset_m(s["frame"])
        if dx or dy:
            s["pos_in"][0] = round(s["pos_in"][0] + dx * M_TO_IN, 3)
            s["pos_in"][1] = round(s["pos_in"][1] + dy * M_TO_IN, 3)
    return out


def changed(before, after):
    return [b["frame"] for a, b in zip(before, after) if a["pos_in"] != b["pos_in"]]


def merge_truth(doc, mask_pass, samples):
    """The truth with the boxes of the frames in the mask pass replaced by the pass's; every other frame keeps its box."""
    redone = {f["frame"] for f in mask_pass["frames"]}
    out = json.loads(json.dumps(doc))
    for h in out["hazards"]:
        if "frame_boxes" not in h:
            continue
        rows = [b for b in h["frame_boxes"] if b["frame"] not in redone]
        for f in mask_pass["frames"]:
            hit = f["boxes"].get(h["id"])
            if hit is not None:
                rows.append({"frame": f["frame"], "t": samples[f["frame"] - 1]["t"], "box_px": hit["box_px"], "area_px": hit["area_px"]})
        rows.sort(key=lambda b: b["frame"])
        h["frame_boxes"] = rows
        h["visible_frames"] = len(rows)
        h["visible_s"] = truth._windows([b["frame"] - 1 for b in rows], samples)
    return out


def top_speed_m_s(samples, fps):
    best = 0.0
    for a, b in zip(samples, samples[1:]):
        best = max(best, ((b["pos_in"][0] - a["pos_in"][0]) ** 2 + (b["pos_in"][1] - a["pos_in"][1]) ** 2) ** 0.5 * finalshots.IN_TO_M * fps)
    return best
