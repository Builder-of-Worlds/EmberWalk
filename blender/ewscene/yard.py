import math

from . import photoscan

SHRUB_ASSET = "scripted:bed_shrub"


def asset_ids(spec, catalog):
    ids = [m["material"] for m in spec["look"]["ground"].get("mix", [])]
    if bed_material(spec):
        ids.append(bed_material(spec))
    if shrubs(spec):
        ids.extend(photoscan.used_ids(catalog[SHRUB_ASSET]))
    return ids


def _block(spec):
    return (spec.get("look") or {}).get("front_yard") or {}


def bed_polygon(spec):
    return [tuple(p) for p in (_block(spec).get("bed") or {}).get("corners_in", [])]


def bed_material(spec):
    bed = _block(spec).get("bed")
    if not bed:
        return None
    return bed["after"] if spec.get("state") == "after" else bed["before"]


def shrubs(spec):
    bed = _block(spec).get("bed") or {}
    return [] if spec.get("state") == "after" else [dict(s) for s in bed.get("shrubs", [])]


def walk_polygon(spec):
    walk = _block(spec).get("walk")
    if not walk:
        return []
    (ax, ay), (bx, by) = walk["from_in"], walk["to_in"]
    length = math.hypot(bx - ax, by - ay)
    nx, ny = -(by - ay) / length * walk["width_in"] / 2.0, (bx - ax) / length * walk["width_in"] / 2.0
    return [(ax + nx, ay + ny), (bx + nx, by + ny), (bx - nx, by - ny), (ax - nx, ay - ny)]


def _inside(poly, x, y):
    hit = False
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i - 1], poly[i]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def contains(spec, x, y):
    return any(poly and _inside(poly, x, y) for poly in (bed_polygon(spec), walk_polygon(spec)))
