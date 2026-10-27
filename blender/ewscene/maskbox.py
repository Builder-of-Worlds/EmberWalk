MIN_MASK_PX = 200
LEVEL_STEP = 60


class MaskError(Exception):
    pass


def level_to_linear(index):
    encoded = index * LEVEL_STEP / 255.0
    return ((encoded + 0.055) / 1.055) ** 2.4


def index_of(grey):
    return (grey + LEVEL_STEP // 2) // LEVEL_STEP


def rows(data, width, height):
    if not isinstance(data, (bytes, bytearray)):
        raise MaskError("mask is %s, expected bytes" % type(data).__name__)
    if width < 1 or height < 1 or len(data) != width * height:
        raise MaskError("mask holds %d values, expected %dx%d" % (len(data), width, height))
    return [bytes(data[y * width:(y + 1) * width]) for y in range(height)]


def extent(mask_rows, index):
    mark = bytes([index])
    left = right = top = bottom = None
    area = 0
    for y, row in enumerate(mask_rows):
        first = row.find(mark)
        if first < 0:
            continue
        last = row.rfind(mark)
        left = first if left is None else min(left, first)
        right = last if right is None else max(right, last)
        top = y if top is None else top
        bottom = y
        area += row.count(mark)
    if area == 0:
        return None
    return {"box_px": [left, top, right + 1, bottom + 1], "area_px": area}


def boxes(data, width, height, indices):
    mask_rows = rows(data, width, height)
    found = {}
    for hazard_id, index in indices.items():
        hit = extent(mask_rows, index)
        found[hazard_id] = hit if hit and hit["area_px"] >= MIN_MASK_PX else None
    return found
