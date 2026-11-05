import math

IN_TO_M = 0.0254
GRID_M = (-12.0, 30.0, -12.0, 34.0)
THIN = 0.3


def keepouts(spec):
    boxes = []
    edges = [f["start_in"] for f in spec["footprint"]]
    xs, ys = [p[0] for p in edges], [p[1] for p in edges]
    boxes.append((min(xs) * IN_TO_M, min(ys) * IN_TO_M, max(xs) * IN_TO_M, max(ys) * IN_TO_M))
    for s in spec["structures"]:
        if s["kind"] != "road":
            boxes.append((s["min_in"][0] * IN_TO_M, s["min_in"][1] * IN_TO_M, s["max_in"][0] * IN_TO_M, s["max_in"][1] * IN_TO_M))
    front = spec["look"]["front_yard"]
    bed = front["bed"]["corners_in"]
    boxes.append((min(p[0] for p in bed) * IN_TO_M, min(p[1] for p in bed) * IN_TO_M, max(p[0] for p in bed) * IN_TO_M, max(p[1] for p in bed) * IN_TO_M))
    walk = [v * IN_TO_M for v in front["walk"]["from_in"] + front["walk"]["to_in"]]
    return {"boxes": boxes, "walk": walk, "walk_half_m": front["walk"]["width_in"] * IN_TO_M / 2 + 0.06}


def blocked(keep, x, y, pad=0.06):
    if any(x0 - pad < x < x1 + pad and y0 - pad < y < y1 + pad for x0, y0, x1, y1 in keep["boxes"]):
        return True
    ax, ay, bx, by = keep["walk"]
    t = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) < keep["walk_half_m"]


def thickness(noise):
    return max(THIN, min(1.0, THIN + (noise - 0.3) * 3.0))
