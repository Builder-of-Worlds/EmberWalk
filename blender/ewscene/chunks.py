import math
import os

from . import geom, route

REACH_IN = 60


def box_corners(box):
    x0, y0, z0, x1, y1, z1 = box
    return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]


def hazard_frames(spec, motion):
    cam = motion["camera"]
    standoff = route.params(spec)["standoff_in"]
    boxes = route.hazard_boxes(spec)
    reach = [(h["distance_in"] + standoff + REACH_IN, box_corners(boxes[h["id"]])) for h in spec["hazards"]]
    return {
        s["frame"] for s in motion["samples"]
        if any(math.dist(c, s["pos_in"]) <= r and geom.in_frame(geom.project(c, s, cam), cam) for r, cs in reach for c in cs)
    }


def plan(frame_count, seen, size):
    if size < 1:
        raise ValueError("a chunk holds at least one frame, not %d" % size)
    out = []
    for start in range(1, frame_count + 1, size):
        end = min(start + size - 1, frame_count)
        out.append({"start_frame": start, "end_frame": end, "hazard_frames": sum(1 for f in seen if start <= f <= end)})
    return sorted(out, key=lambda c: (-c["hazard_frames"], c["start_frame"]))


def frame_name(frame):
    return "synthetic-frame-%05d.png" % frame


def todo(chunk, folder):
    out = []
    for f in range(chunk["start_frame"], chunk["end_frame"] + 1):
        path = os.path.join(folder, frame_name(f))
        if not (os.path.isfile(path) and os.path.getsize(path) > 0):
            out.append(f)
    return out
