import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Vector

from ewscene import assets, blendscene, house, route
from ewscene.units import in_to_m, m_to_in

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "synthetic")
WANT = {"mobile-before": ["carport", "front-porch"], "apartment-before": ["stair-steps", "stair-landing", "balcony-back-middle"]}


def build(name):
    with open(os.path.join(FIXTURES, name, "spec.json"), encoding="utf-8") as f:
        spec = json.load(f)
    catalog = assets.load_catalog()
    house.validate(spec, catalog, house.load_rules())
    house.roof_prisms(spec)
    motion, _ = route.build(spec)
    manifests = {u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir()) for u in house.used_assets(spec, catalog) if u["kind"] != "scripted"}
    blendscene.build_house(spec, catalog, manifests, motion)
    return spec


def hits(obj, origin_in, direction):
    o = Vector([in_to_m(v) for v in origin_in])
    ok, loc, normal, index = obj.ray_cast(o, Vector(direction))
    return bool(ok)


def main():
    out = {}
    for name, ids in WANT.items():
        spec = build(name)
        structures = {s["id"]: s for s in spec["structures"]}
        for sid in ids:
            s = structures[sid]
            obj = bpy.data.objects[sid]
            (x0, y0), (x1, y1), top = s["min_in"], s["max_in"], s["height_in"]
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            lo, hi = blendscene.world_bounds([obj])
            rec = {"kind": s["kind"], "top": top, "lo": [m_to_in(c) for c in lo], "hi": [m_to_in(c) for c in hi],
                   "polys": len(obj.data.polygons)}
            rec["side_at_2in"] = [hits(obj, (x0 - 40, cy, 2.0), (1, 0, 0)), hits(obj, (cx, y0 - 40, 2.0), (0, 1, 0))]
            rec["from_above"] = hits(obj, (cx, cy, top + 40.0), (0, 0, -1))
            out[sid] = rec
    print("EW_OPEN " + json.dumps(out))


main()
