POST_IN = 4.0
POST_PITCH_IN = 48
CAP_IN = 2.0
CAP_OVERHANG_IN = 0.5
RAIL_IN = 1.5
RAIL_DEPTH_IN = 3.5
RAIL_FROM_GROUND_IN = 10
RAIL_FROM_TOP_IN = 12
PICKET_IN = 3.5
PICKET_PITCH_IN = 5.5
PICKET_FRONT_IN = 1.0
PICKET_BACK_IN = 2.25
PICKET_FROM_GROUND_IN = 2.0
PICKET_BELOW_TOP_IN = 4.0
PICKET_TOP_JITTER_IN = 1.0
KICKBOARD_FRONT_IN = 0.25
KICKBOARD_IN = 6.0
MIN_RUN_IN = 24
MIN_HEIGHT_IN = 36


def picket_boxes(size, rng):
    w, d, h = size
    if d < MIN_RUN_IN or h < MIN_HEIGHT_IN or w < 4:
        raise ValueError("picket fence %s is too small: it needs a run of %d in, a height of %d in and a thickness of 4 in" % (list(size), MIN_RUN_IN, MIN_HEIGHT_IN))
    out = []
    posts = max(2, int(d // POST_PITCH_IN) + 1)
    step = (d - POST_IN) / (posts - 1)
    for i in range(posts):
        y = i * step
        out.append(("post", (0, y, 0), (w - CAP_OVERHANG_IN, y + POST_IN, h)))
        out.append(("cap", (-CAP_OVERHANG_IN, y - CAP_OVERHANG_IN, h - CAP_IN), (w, y + POST_IN + CAP_OVERHANG_IN, h)))
    for z in (RAIL_FROM_GROUND_IN, h * 0.55, h - RAIL_FROM_TOP_IN):
        out.append(("rail", (PICKET_BACK_IN, 0, z), (PICKET_BACK_IN + RAIL_IN, d, z + RAIL_DEPTH_IN)))
    out.append(("kickboard", (KICKBOARD_FRONT_IN, 0, 0), (PICKET_FRONT_IN, d, KICKBOARD_IN)))
    y = 0.0
    while y + PICKET_IN <= d:
        top = h - PICKET_BELOW_TOP_IN - rng.uniform(0, PICKET_TOP_JITTER_IN)
        out.append(("picket", (PICKET_FRONT_IN, y, PICKET_FROM_GROUND_IN), (PICKET_BACK_IN, y + PICKET_IN, top)))
        y += PICKET_PITCH_IN
    return out
