import argparse
import json
import os
import random
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh
import bpy
from mathutils import Vector

from ewscene import assets, blendscene, paths
from ewscene.units import in_to_m, m_to_in


def inches(co):
    return [round(m_to_in(c), 4) for c in co]


def bounds(points):
    return {"min": [min(p[i] for p in points) for i in range(3)], "max": [max(p[i] for p in points) for i in range(3)]}


def islands(bm):
    root = list(range(len(bm.verts)))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i

    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        root[a] = b
    groups = {}
    for v in bm.verts:
        groups.setdefault(find(v.index), []).append(v)
    out = []
    for members in groups.values():
        keep = {v.index for v in members}
        verts = [inches(v.co) for v in members]
        caps = []
        for f in bm.faces:
            if len(f.verts) > 4 and f.verts[0].index in keep:
                centre = inches(f.calc_center_median())
                radius = sum((v.co - f.calc_center_median()).length for v in f.verts) / len(f.verts)
                caps.append({"centre": centre, "radius_in": round(m_to_in(radius), 4)})
        out.append(dict(bounds(verts), verts=verts, caps=caps))
    return out


def record(bm, detail):
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    points = [inches(v.co) for v in bm.verts]
    out = bounds(points) if points else {"min": None, "max": None}
    if detail:
        out["islands"] = islands(bm)
        out["face_centres"] = [inches(f.calc_center_median()) for f in bm.faces]
    return out


def scene_objects(detail, every_vert):
    out = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        out[obj.name] = record(bm, obj.name in detail)
        out[obj.name]["materials"] = [m.name for m in obj.data.materials if m]
        out[obj.name]["shadow"] = obj.visible_shadow
        if obj.name in every_vert:
            out[obj.name]["verts"] = [inches(v.co) for v in bm.verts]
        bm.free()
    return out


def scripted(spec_paths, detail):
    out = []
    for path in spec_paths:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        for h in doc.get("hazards", []) + doc.get("fixed", []):
            builder = blendscene.HOUSE_SCRIPTED.get(h["asset"])
            if builder is None:
                continue
            parts = {}
            for key, bm in builder(h["size_in"], random.Random(h["id"])).items():
                parts[key] = record(bm, h["asset"] in detail)
                bm.free()
            out.append({"asset": h["asset"], "id": h["id"], "size_in": h["size_in"], "spec": path, "parts": parts})
    return out


def world_graph():
    tree = bpy.context.scene.world.node_tree
    nodes = [{"name": n.name, "type": n.bl_idname, "image": n.image.filepath if getattr(n, "image", None) else None,
              "ramp": [{"position": e.position, "color": list(e.color)} for e in n.color_ramp.elements] if n.bl_idname == "ShaderNodeValToRGB" else None,
              "scale": n.inputs["Scale"].default_value if n.bl_idname == "ShaderNodeTexNoise" else None}
             for n in tree.nodes]
    links = [{"from": l.from_node.name, "out": l.from_socket.identifier, "to": l.to_node.name, "in": l.to_socket.identifier}
             for l in tree.links if l.is_valid]
    return {"nodes": nodes, "links": links}


def painted(asset_id):
    catalog = assets.load_catalog()
    manifest = assets.ensure(asset_id, catalog[asset_id], assets.cache_dir())
    mat = blendscene.painted_material("Probe paint", manifest, "#808080", [1.0, 1.0, 1.0], blendscene.SIDING_GRAIN)
    return {"use_nodes": mat.use_nodes, "nodes": sorted(n.bl_idname for n in mat.node_tree.nodes)}


PRINCIPLED = ("Base Color", "Roughness", "Metallic", "Transmission Weight", "IOR")


def materials():
    out = {}
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        inputs = {k: (list(bsdf.inputs[k].default_value)[:3] if k == "Base Color" else bsdf.inputs[k].default_value) for k in PRINCIPLED} if bsdf else {}
        images = sorted(os.path.basename(n.image.filepath) for n in mat.node_tree.nodes if getattr(n, "image", None))
        out[mat.name] = {"inputs": inputs, "images": images}
    return out


def cast(rays):
    graph = bpy.context.evaluated_depsgraph_get()
    out = []
    for ray in rays:
        origin = Vector([in_to_m(v) for v in ray["origin_in"]])
        direction = Vector(ray["dir"]).normalized()
        start, travelled, hits = origin.copy(), 0.0, []
        while len(hits) < 5:
            hit, loc, _, _, obj, _ = bpy.context.scene.ray_cast(graph, start, direction)
            if not hit:
                break
            travelled += (loc - start).length
            hits.append({"object": obj.name, "distance_in": round(m_to_in(travelled), 4)})
            start = loc + direction * 1e-4
            travelled += 1e-4
        out.append(hits)
    return out


def scene_record():
    scene = bpy.context.scene
    rd = scene.render
    stamps = [k for k in dir(rd) if k.startswith("use_stamp") and getattr(rd, k) is True]
    return {"engine": rd.engine, "version": list(bpy.app.version),
            "engines": [e.identifier for e in rd.bl_rna.properties["engine"].enum_items],
            "use_stamp": rd.use_stamp, "stamps_on": stamps,
            "types": sorted({o.type for o in bpy.data.objects}),
            "images": sorted({os.path.normpath(bpy.path.abspath(i.filepath)) for i in bpy.data.images if i.filepath})}


def main():
    parser = argparse.ArgumentParser(prog="dump_house.py")
    parser.add_argument("--out", required=True)
    parser.add_argument("--detail", action="append", default=[])
    parser.add_argument("--verts", action="append", default=[])
    parser.add_argument("--structures")
    parser.add_argument("--specs", nargs="*", default=[])
    parser.add_argument("--paint")
    parser.add_argument("--rays")
    args = parser.parse_args(paths.script_args())
    built = {"scene": scene_record(), "world": world_graph(), "materials": materials()}
    if args.rays:
        with open(args.rays, encoding="utf-8") as f:
            built["rays"] = cast(json.load(f))
    built["final"] = blendscene.final_settings()
    built["node_owner"] = blendscene.node_owner(types.SimpleNamespace(use_nodes=False)).use_nodes
    if args.paint:
        built["painted"] = painted(args.paint)
    if args.structures:
        with open(args.structures, encoding="utf-8") as f:
            structures = json.load(f)
        for s in structures:
            blendscene._structure(s, structures)
    body = {"objects": scene_objects(set(args.detail), set(args.verts)), "scripted": scripted(args.specs, set(args.detail)),
            "builders": sorted(blendscene.HOUSE_SCRIPTED), **built}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(body, f)


main()
