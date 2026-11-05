import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from ewscene import assets, blendscene, house, route
from ewscene.units import m_to_in

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "synthetic")


def points(obj):
    return [[m_to_in(c) for c in (obj.matrix_world @ v.co)] for v in obj.data.vertices]


def main():
    with open(os.path.join(FIXTURES, "apartment-before", "spec.json"), encoding="utf-8") as f:
        spec = json.load(f)
    catalog = assets.load_catalog()
    house.validate(spec, catalog, house.load_rules())
    house.roof_prisms(spec)
    motion, _ = route.build(spec)
    manifests = {u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir()) for u in house.used_assets(spec, catalog) if u["kind"] != "scripted"}
    blendscene.build_house(spec, catalog, manifests, motion)
    out = {"trees": {}, "limbs": {}, "branches": {}}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        tree_id = o.get(blendscene.TREE_TAG)
        if tree_id:
            out["trees"].setdefault(tree_id, []).append({"name": o.name, "photo": bool(o.get(blendscene.PHOTO_TAG)), "polys": len(o.data.polygons)})
            if o.name == tree_id + " limbs":
                out["limbs"][tree_id] = points(o)
        if o.get(blendscene.HAZARD_TAG) and o.name in {b for t in spec["trees"] for b in t["branches"]}:
            out["branches"][o.name] = points(o)
    print("EW_CARRIERS " + json.dumps(out))


main()
