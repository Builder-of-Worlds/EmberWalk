import math

REGIONS = ("driveway", "sky", "glass")
MIN_PIXELS = 40
WHITE = 0.6875
FLAT = 0.03125
GRAIN = 0.015625
BLACK = 0.0625
WEIGHTS = (0.2126, 0.7152, 0.0722)


class StillError(Exception):
    pass


def luminance(rgb):
    if len(rgb) < 3:
        raise StillError("a pixel needs red, green and blue, got %r" % (rgb,))
    for c in rgb[:3]:
        if not 0.0 <= c <= 1.0:
            raise StillError("a display value lies outside 0 to 1: %r" % (rgb,))
    return sum(w * c for w, c in zip(WEIGHTS, rgb))


def region_stats(grid):
    sums = {}
    for row in grid:
        prev = None
        for cell in row:
            region, y = None, None
            if cell is not None and cell[0] is not None:
                region = cell[0]
                if region not in REGIONS:
                    raise StillError("unknown region %r" % region)
                y = luminance(cell[1])
                n, s, sq, pairs, step = sums.get(region, (0, 0.0, 0.0, 0, 0.0))
                if prev is not None and prev[0] == region:
                    pairs, step = pairs + 1, step + abs(y - prev[1])
                sums[region] = (n + 1, s + y, sq + y * y, pairs, step)
            prev = (region, y) if region else None
    out = {}
    for region, (n, s, sq, pairs, step) in sums.items():
        mean = s / n
        out[region] = {"pixels": n, "mean": mean, "spread": math.sqrt(max(0.0, sq / n - mean * mean)),
                       "grain": step / pairs if pairs else 0.0}
    return out


def faults(stats):
    out = []
    for region in REGIONS:
        st = stats.get(region)
        if not st or st["pixels"] < MIN_PIXELS:
            continue
        if region == "glass":
            if st["mean"] < BLACK:
                out.append("glass is near pure black (mean %.3f under %.2f)" % (st["mean"], BLACK))
            continue
        if st["mean"] >= WHITE:
            out.append("%s is near white (mean %.3f at or over %.2f)" % (region, st["mean"], WHITE))
        if region == "sky" and st["spread"] < FLAT:
            out.append("sky is flat, no gradient or cloud (spread %.3f under %.3f)" % (st["spread"], FLAT))
        if region == "driveway" and st["grain"] < GRAIN:
            out.append("driveway is flat, no texture (grain %.4f under %.3f)" % (st["grain"], GRAIN))
    return out
