import hashlib
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh
import bpy
import numpy
from mathutils import Vector

from ewscene import blendscene, house
from ewscene.units import in_to_m, m_to_in

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "fixtures", "synthetic")
INCH3_PER_M3 = (1.0 / in_to_m(1.0)) ** 3
OUTWARD = {"west": (-1, 0), "east": (1, 0), "south": (0, -1), "north": (0, 1)}


def spec_of(name):
    with open(os.path.join(FIXTURES, name, "spec.json"), encoding="utf-8") as f:
        return json.load(f)


def bounds_in(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return [[round(m_to_in(f(p[i] for p in pts)), 3) for i in range(3)] for f in (min, max)]


def ray(frame, origin, direction):
    start, unit, out, bottom = frame
    along, across, up = origin
    world = Vector([in_to_m(c) for c in (start[0] + unit[0] * along + out[0] * across, start[1] + unit[1] * along + out[1] * across, bottom + up)])
    way = Vector((unit[0] * direction[0] + out[0] * direction[1], unit[1] * direction[0] + out[1] * direction[1], direction[2])).normalized()
    hit, loc, _, _, obj, _ = bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(), world, way)
    if not hit:
        return None
    p = [m_to_in(c) for c in loc]
    rel = (p[0] - start[0], p[1] - start[1])
    return {"object": obj.name, "u": rel[0] * unit[0] + rel[1] * unit[1], "v": rel[0] * out[0] + rel[1] * out[1], "z": p[2] - bottom}


def base_colour(mat):
    return list(mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value)[:3]


def gutters(name):
    spec = spec_of(name)
    blendscene.reset()
    blendscene._gutters(spec)
    bpy.context.view_layer.update()
    width = spec["house"]["roof"]["eave_in"]
    trim = blendscene.plain_material("Trim paint", spec["look"]["trim"]["colour"], 0.55)
    trim_bsdf = trim.node_tree.nodes["Principled BSDF"]
    runs = []
    for k, g in enumerate(house.gutter_runs(spec), 1):
        obj = bpy.data.objects["Gutter %d" % k]
        (x0, y0), (x1, y1) = g["start"], g["end"]
        run = math.hypot(x1 - x0, y1 - y0)
        frame = ((x0, y0), ((x1 - x0) / run, (y1 - y0) / run), OUTWARD[g["facing"]], g["z_in"] - blendscene.GUTTER_TALL_IN)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        mid, t = run / 2.0, blendscene.GUTTER_TALL_IN
        mat = obj.data.materials[0]
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        runs.append({
            "run": g, "width": width, "length": run, "bounds": bounds_in(obj), "volume_in3": abs(bm.calc_volume()) * INCH3_PER_M3,
            "material": {"name": mat.name, "colour": base_colour(mat), "roughness": bsdf.inputs["Roughness"].default_value, "metallic": bsdf.inputs["Metallic"].default_value},
            "rays": {
                "down": ray(frame, (mid, width / 2.0, t + 8), (0, 0, -1)),
                "up": ray(frame, (mid, width / 2.0, 2.5), (0, 0, 1)),
                "to_back": ray(frame, (mid, width / 2.0, 2.5), (0, -1, 0)),
                "to_front": ray(frame, (mid, width / 2.0, 2.5), (0, 1, 0)),
                "from_outside": ray(frame, (mid, width + 10, 2.5), (0, -1, 0)),
                "end_cap": ray(frame, (-10, width / 2.0, 0.15), (1, 0, 0)),
            },
        })
        bm.free()
    return {"trim": {"name": trim.name, "colour": base_colour(trim), "roughness": trim_bsdf.inputs["Roughness"].default_value}, "runs": runs}


def downspouts(name, asked):
    spec = spec_of(name)
    if not asked:
        spec["house"]["features"].pop("downspouts", None)
    blendscene.reset()
    blendscene._gutters(spec)
    blendscene._downspouts(spec)
    bpy.context.view_layer.update()
    pipes = []
    for obj in sorted((o for o in bpy.data.objects if o.name.startswith("Downspout ")), key=lambda o: o.name):
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        pipes.append({"name": obj.name, "material": obj.data.materials[0].name, "bounds": bounds_in(obj),
                      "verts": [[m_to_in(c) for c in p] for p in pts], "faces": len(obj.data.polygons),
                      "edges": [list(e.vertices) for e in obj.data.edges]})
    return {"gutter_material": bpy.data.objects["Gutter 1"].data.materials[0].name, "pipes": pipes}


def components(bm):
    bm.verts.index_update()
    root = list(range(len(bm.verts)))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i

    bm.verts.ensure_lookup_table()
    for e in bm.edges:
        root[find(e.verts[0].index)] = find(e.verts[1].index)
    groups = {}
    for v in bm.verts:
        groups.setdefault(find(v.index), []).append(v)
    out = []
    for members in groups.values():
        pts = numpy.array([[m_to_in(c) for c in v.co] for v in members])
        eig = numpy.linalg.eigvalsh(numpy.cov(pts.T)) if len(pts) > 2 else numpy.zeros(3)
        faces = {f for v in members for f in v.link_faces}
        out.append({"verts": len(members), "faces": len(faces), "min": pts.min(axis=0).round(3).tolist(), "max": pts.max(axis=0).round(3).tolist(),
                    "elong": float(math.sqrt(eig[2] / max(eig[1], 1e-9))), "flat": float(math.sqrt(max(eig[0], 0.0)))})
    return out


def face_sizes(bm):
    sizes = {}
    for f in bm.faces:
        sizes[len(f.verts)] = sizes.get(len(f.verts), 0) + 1
    return sizes


def parts_record(parts):
    out = {}
    for key, bm in parts.items():
        out[key] = {"components": components(bm), "face_sizes": face_sizes(bm)}
        bm.free()
    return out


def gutter_leaves(name):
    spec = spec_of(name)
    out, seen = [], []
    real = blendscene._stretch

    def spy(parts, size):
        verts = [v for bm in parts for v in bm.verts]
        seen.append([(max(v.co[i] for v in verts) - min(v.co[i] for v in verts)) / in_to_m(size[i]) for i in range(3)])
        real(parts, size)

    blendscene._stretch = spy
    try:
        for h in spec["hazards"] + spec.get("fixed", []):
            if h["asset"] == "scripted:gutter_leaves":
                parts = blendscene.HOUSE_SCRIPTED[h["asset"]](h["size_in"], random.Random(h["id"]))
                out.append({"id": h["id"], "size_in": h["size_in"], "squash": seen[-1], "parts": parts_record(parts)})
    finally:
        blendscene._stretch = real
    return out


def foliage():
    branch = parts_record(blendscene._overhanging_branch([96, 72, 40], random.Random("branch-over-roof-back")))
    out = {"branch": branch}
    for form, tree in (("oak", {"height_in": 360, "canopy_in": 300, "trunk_in": 20}), ("conifer", {"height_in": 600, "canopy_in": 200, "trunk_in": 16})):
        bark, leaves = bmesh.new(), bmesh.new()
        {"oak": blendscene._oak, "conifer": blendscene._conifer}[form](bark, leaves, tree, random.Random("probe-" + form))
        out[form] = parts_record({"leaves": leaves})
        bark.free()
    return out


def bark_signature(form, bare):
    """A digest of the bark mesh, built with the real leaves or with the leaf builder swapped for one that draws nothing."""
    real = blendscene._leaves
    if bare:
        blendscene._leaves = lambda *args, **kwargs: None
    try:
        if form == "branch":
            bark = blendscene._overhanging_branch([96, 72, 40], random.Random("branch-over-roof-back"))["main"]
        else:
            tree = {"oak": {"height_in": 360, "canopy_in": 300, "trunk_in": 20}, "conifer": {"height_in": 600, "canopy_in": 200, "trunk_in": 16}}[form]
            bark, leaves = bmesh.new(), bmesh.new()
            {"oak": blendscene._oak, "conifer": blendscene._conifer}[form](bark, leaves, tree, random.Random("probe-" + form))
            leaves.free()
        return hashlib.sha1(json.dumps([[round(c, 5) for c in v.co] for v in bark.verts]).encode()).hexdigest()
    finally:
        blendscene._leaves = real


record = {
    "bark": {form: {"real": bark_signature(form, False), "bare": bark_signature(form, True)} for form in ("branch", "conifer")},
    "gutters": {name: gutters(name) for name in ("hero-before", "apartment-before")},
    "downspouts": {name: {"asked": downspouts(name, True), "none": downspouts(name, False)} for name in ("hero-before", "apartment-before")},
    "leaves": {name: gutter_leaves(name) for name in ("hero-before", "apartment-before")},
    "foliage": foliage(),
    "accents": {k: v[0] for k, v in blendscene.ACCENTS.items()},
    "lip_in": blendscene.GUTTER_TALL_IN,
    "spill_in": blendscene.GUTTER_SPILL_IN,
}
print("EW_MODELS " + json.dumps(record))
