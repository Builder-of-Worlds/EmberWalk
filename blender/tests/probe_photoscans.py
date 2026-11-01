import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy
from mathutils import Vector

from ewscene import assets, blendscene, house, route
from ewscene.units import m_to_in

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "synthetic")


def box_in_house_axes(h, edge):
    ux, uy = edge["u"]
    nx, ny = edge["n"]
    corners = []
    for a in (h["along_in"], h["along_in"] + h["size_in"][0]):
        for o in (h["distance_in"], h["distance_in"] + h["size_in"][1]):
            corners.append((edge["start"][0] + ux * a + nx * o, edge["start"][1] + uy * a + ny * o))
    return [min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners)]


def bounds_in(obj):
    lo, hi = blendscene.world_bounds([obj])
    return [m_to_in(c) for c in lo], [m_to_in(c) for c in hi]


def lap_facts(spec):
    laps = bpy.data.objects.get("House siding laps")
    if laps is None:
        return None
    lo, hi = bounds_in(laps)
    wlo, whi = bounds_in(bpy.data.objects["House wall"])
    return {"tagged": bool(laps.get(blendscene.HAZARD_TAG)), "faces": len(laps.data.polygons), "lo": lo, "hi": hi, "wall_lo": wlo, "wall_hi": whi,
            "levels": sorted({round(m_to_in(v.co.z), 2) for v in laps.data.vertices}), "wall_in": house.roof_prisms(spec)[0]["wall_in"]}


def roof_facts():
    out = []
    for m in bpy.data.materials:
        if not m.name.startswith("Roof paint"):
            continue
        nodes = m.node_tree.nodes
        bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
        paint = next(n for n in nodes if n.type == "MIX").inputs[7].default_value
        scale = next(n for n in nodes if n.type == "MAPPING").inputs["Scale"].default_value
        floor = [n.inputs[1].default_value for n in nodes if n.type == "MATH" and n.operation == "MAXIMUM"]
        out.append({"albedo": 0.2126 * paint[0] + 0.7152 * paint[1] + 0.0722 * paint[2], "tile_m": 1.0 / scale[0],
                    "normal": next(n for n in nodes if n.type == "NORMAL_MAP").inputs["Strength"].default_value,
                    "rough_floor": max(floor) if floor else 0.0, "specular": bsdf.inputs["Specular IOR Level"].default_value})
    return out


def main():
    with open(os.path.join(FIXTURES, "hero-before", "spec.json"), encoding="utf-8") as f:
        spec = json.load(f)
    catalog = assets.load_catalog()
    house.validate(spec, catalog, house.load_rules())
    house.roof_prisms(spec)
    motion, _ = route.build(spec)
    manifests = {u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir()) for u in house.used_assets(spec, catalog) if u["kind"] != "scripted"}
    blendscene.build_house(spec, catalog, manifests, motion)
    by_side = {e["side"]: e for e in house.edges(spec)}
    dg = bpy.context.evaluated_depsgraph_get()
    out = {"trees": {}, "hazards": {}, "walls": [], "meadow": 0, "templates": 0}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.get(blendscene.TREE_TAG):
            out["trees"].setdefault(o[blendscene.TREE_TAG], []).append({"polys": len(o.data.polygons), "photo": bool(o.get(blendscene.PHOTO_TAG))})
        if o.get(blendscene.HAZARD_TAG):
            lo, hi = blendscene.world_bounds([o])
            rec = out["hazards"].setdefault(o[blendscene.HAZARD_TAG], {"lo": [1e9] * 3, "hi": [-1e9] * 3, "photo": False})
            rec["lo"] = [min(a, m_to_in(b)) for a, b in zip(rec["lo"], lo)]
            rec["hi"] = [max(a, m_to_in(b)) for a, b in zip(rec["hi"], hi)]
            rec["photo"] = rec["photo"] or bool(o.get(blendscene.PHOTO_TAG))
        if o.name.startswith("Meadow"):
            out["meadow"] += len(o.data.polygons)
        if o.name.startswith("House wall") or o.get("ew_role") == "wall":
            out["walls"].append({"name": o.name, "tagged": bool(o.get(blendscene.HAZARD_TAG))})
    mat_of = lambda name: [m.name for m in bpy.data.objects[name].data.materials if m] if name in bpy.data.objects else []
    out["siding"] = {"wall": mat_of("House wall"), "door": mat_of("Garage door"), "panels": mat_of("Garage door panels")}
    edge = by_side[spec["house"]["features"]["garage_door"]["side"]]
    panels = bpy.data.objects["Garage door panels"]
    local = [(m_to_in(v.co.x) - edge["start"][0], m_to_in(v.co.y) - edge["start"][1], m_to_in(v.co.z)) for v in panels.data.vertices]
    along = {round(p[0] * edge["u"][0] + p[1] * edge["u"][1], 1) for p in local}
    outward = [p[0] * edge["n"][0] + p[1] * edge["n"][1] for p in local]
    out["garage"] = {"cols": len(along) // 2, "rows": len({round(p[2], 1) for p in local}) // 2, "relief_in": round(max(outward) - min(outward), 2),
                     "span_in": round(max(along) - min(along), 1)}
    out["fills"] = [[round(c, 3) for c in (o.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0)))] for o in bpy.data.objects if o.type == "LIGHT" and o.data.type == "SUN" and not o.data.use_shadow]
    bed_images = sorted({n.image.name for m in (bpy.data.objects["Front bed"].data.materials if "Front bed" in bpy.data.objects else []) if m and m.node_tree for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image})
    out["yard"] = {"bed": bed_images, "walk": mat_of("Front walk"), "shrubs": sorted(o.name for o in bpy.data.objects if o.name.startswith("Bed shrub"))}
    out["ring_trees"] = len({o.name.split(" ")[0] for o in bpy.data.objects if o.name.startswith("wood-")})
    out["haze"] = bool(bpy.context.scene.compositing_node_group)
    out["laps"] = lap_facts(spec)
    out["roofs"] = roof_facts()
    out["boxes"] ={h["id"]: box_in_house_axes(h, by_side[h["side"]]) + [h.get("elevation_in", 0), h.get("elevation_in", 0) + h["size_in"][2]] for h in spec["hazards"]}
    out["photo_hazards"] = [h["id"] for h in spec["hazards"] if catalog[h["asset"]].get("photoscan")]
    print("EW_PHOTO " + json.dumps(out))


main()
