import math

from . import geom

STEP_HZ = 1.8
CONVENTIONS = {
    "pos_in": "inches in scene axes: x along the wall from its right end as seen from the yard, y out from the wall face, z up from the ground",
    "heading_deg": "compass style about z: 0 looks out along +y, 90 along +x, 180 faces the wall",
    "tilt_deg": "degrees below the horizon",
    "roll_deg": "turn about the view axis, positive when the top of the phone turns right as the holder sees it",
    "t": "seconds from the first frame",
}


def _wave(t, hz, phase=0.0):
    return math.sin(2 * math.pi * hz * t + phase)


def pose(walk, i, n):
    fps = walk["fps"]
    t = i / fps
    u = i / (n - 1)
    gait = (1 - math.cos(2 * math.pi * u)) / 2
    x = walk["start_along_in"] + (walk["end_along_in"] - walk["start_along_in"]) * (u - math.sin(2 * math.pi * u) / (2 * math.pi))
    y = walk["standoff_in"] + 0.5 * gait * _wave(t, STEP_HZ / 2)
    z = walk["height_in"] + 0.75 * gait * _wave(t, STEP_HZ)
    heading = 180 + 1.2 * _wave(t, 0.23) + 0.5 * _wave(t, 0.71, 1.0) + 0.3 * gait * _wave(t, STEP_HZ / 2)
    tilt = walk["tilt_deg"] + 0.9 * _wave(t, 0.31, 0.5) + 0.35 * gait * _wave(t, STEP_HZ, 0.8)
    roll = 0.7 * _wave(t, 0.4, 2.0) + 0.3 * gait * _wave(t, STEP_HZ / 2, 0.3)
    return {
        "frame": i + 1,
        "t": round(t, 6),
        "pos_in": [round(x, 2), round(y, 2), round(z, 2)],
        "heading_deg": round(heading, 3),
        "tilt_deg": round(tilt, 3),
        "roll_deg": round(roll, 3),
    }


def build(spec):
    walk = spec["walk"]
    n = walk["fps"] * walk["duration_s"]
    camera = {k: walk[k] for k in ("width_px", "height_px", "focal_mm", "sensor_width_mm")}
    hfov, vfov = geom.fov_deg(camera)
    camera.update(sensor_fit="horizontal", hfov_deg=round(hfov, 3), vfov_deg=round(vfov, 3))
    return {
        "schema": "emberwalk.motion/1",
        "synthetic": True,
        "label": spec["label"],
        "scene": spec["id"],
        "fps": walk["fps"],
        "frame_count": n,
        "duration_s": walk["duration_s"],
        "camera": camera,
        "conventions": CONVENTIONS,
        "samples": [pose(walk, i, n) for i in range(n)],
    }
