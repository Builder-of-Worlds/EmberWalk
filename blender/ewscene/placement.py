MAX_DISTANCE_IN = 1200

BANDS = (("0_5", 60), ("5_30", 360), ("30_100", MAX_DISTANCE_IN))


def band(distance_in):
    if distance_in < 0:
        raise ValueError("negative distance %s" % distance_in)
    for name, upper in BANDS:
        if distance_in <= upper:
            return name
    raise ValueError("distance %s is past 100 feet" % distance_in)


def hazard_box(hazard):
    w, d, h = hazard["size_in"]
    x, y = hazard["along_in"], hazard["distance_in"]
    return (x, y, 0), (x + w, y + d, h)


def distance_from_wall(box):
    return box[0][1]


def overlaps(a, b):
    return all(a[0][i] < b[1][i] and b[0][i] < a[1][i] for i in range(3))


def crosses_walk(box, standoff_in, start_in, end_in):
    lo, hi = box
    return lo[1] <= standoff_in <= hi[1] and lo[0] <= end_in and start_in <= hi[0]
