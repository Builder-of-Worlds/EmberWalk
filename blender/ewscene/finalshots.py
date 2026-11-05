import math

from . import geom

IN_TO_M = 0.0254


HALF_FOV_LANDSCAPE = (42.0, 26.85)
HALF_FOV_PORTRAIT = (26.9, 42.0)
PORTRAIT_SPANS = ((1498, 2097), (3097, 3696), (4546, 5145), (5623, 6177))


def aerial_centre(spec, frame_m, grid_m):
    pts = [p["start_in"] for p in spec["footprint"]]
    cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2 * IN_TO_M
    cy = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2 * IN_TO_M
    x0, x1, y0, y1 = grid_m
    half = frame_m / 2
    if not (x0 <= cx - half and cx + half <= x1 and y0 <= cy - half and cy + half <= y1):
        raise ValueError("the %.0f m frame at %.2f, %.2f leaves the scanned grid %s" % (frame_m, cx, cy, tuple(grid_m)))
    return cx, cy


def sample_at(walk, frame):
    s = walk["samples"][frame - 1]
    if s["frame"] != frame:
        raise ValueError("sample %d is frame %d" % (frame, s["frame"]))
    return s


def deck_in_view(sample, box_in, half_fov_deg, margin_deg=8.0):
    r = geom.camera_rotation(sample["heading_deg"], 0.0, 0.0)
    limit_x, limit_y = (math.tan(math.radians(h + margin_deg)) for h in half_fov_deg)
    lo, hi = box_in["min_in"], box_in["max_in"]
    for i in range(17):
        for j in range(5):
            for k in range(2):
                p = [lo[0] + (hi[0] - lo[0]) * i / 16, lo[1] + (hi[1] - lo[1]) * j / 4, lo[2] + (hi[2] - lo[2]) * k]
                x, y, z = geom.apply(geom.transpose(r), [p[n] - sample["pos_in"][n] for n in range(3)])
                if z < 0 and abs(x / -z) <= limit_x and abs(y / -z) <= limit_y:
                    return True
    return False


def faces_camera(sample, centre_in, outward):
    return (sample["pos_in"][0] - centre_in[0]) * outward[0] + (sample["pos_in"][1] - centre_in[1]) * outward[1] > 0


def deck_candidates(walk, box_in, half_fov_deg, outward=None):
    return [s["frame"] for s in walk["samples"]
            if (outward is None or faces_camera(s, outward[0], outward[1])) and deck_in_view(s, box_in, half_fov_deg)]


def runs(frames):
    out = []
    for f in frames:
        if out and f == out[-1][1] + 1:
            out[-1] = (out[-1][0], f)
        else:
            out.append((f, f))
    return out


def patch_order(frames, last_frame, priority_spans):
    early = sorted(n for n in frames if n <= last_frame)
    first = [n for n in early if any(a <= n <= b for a, b in priority_spans)]
    return first + [n for n in early if n not in set(first)]


def chunk(order, start, count):
    return order[start:start + count]


def still_pose(sample, camera):
    if "shift_y" in sample:
        shift = sample["shift_y"]
    else:
        shift = -math.tan(math.radians(sample["tilt_deg"])) * camera["focal_mm"] / camera["sensor_width_mm"]
    return {"location_m": [v * IN_TO_M for v in sample["pos_in"]], "heading_deg": sample["heading_deg"], "shift_y": shift}
