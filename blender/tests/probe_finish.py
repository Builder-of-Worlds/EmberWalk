import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy

from ewscene import assets, blendscene, house, route

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "synthetic")


def base_colour(mat):
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    socket = bsdf.inputs["Base Color"] if bsdf else None
    if socket is None or socket.is_linked:
        return None
    return list(socket.default_value)[:3]


def main():
    name = sys.argv[sys.argv.index("--") + 1]
    with open(os.path.join(FIXTURES, name + "-before", "spec.json"), encoding="utf-8") as f:
        spec = json.load(f)
    catalog = assets.load_catalog()
    house.validate(spec, catalog, house.load_rules())
    house.roof_prisms(spec)
    motion, _ = route.build(spec)
    manifests = {u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir()) for u in house.used_assets(spec, catalog) if u["kind"] != "scripted"}
    blendscene.build_house(spec, catalog, manifests, motion)
    bins, grass = {}, {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        tag = o.get(blendscene.HAZARD_TAG)
        if tag and tag.startswith("trash-cans"):
            bins.setdefault(tag, []).extend(c for c in (base_colour(m) for m in o.data.materials if m) if c)
        if tag and o.name == tag and any(h["id"] == tag and h["asset"] == "scripted:tall_dry_grass" for h in spec["hazards"]):
            grass[tag] = len(o.data.polygons)
    out = {"finish": blendscene.finish(spec),
           "rooms": sorted(m.name for m in bpy.data.materials if m.name.startswith("Window room")),
           "bins": bins, "grass": grass,
           "grass_sizes": {h["id"]: h["size_in"] for h in spec["hazards"] if h["asset"] == "scripted:tall_dry_grass"}}
    print("EW_FINISH " + json.dumps(out))


main()
