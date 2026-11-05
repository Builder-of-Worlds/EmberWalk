import argparse
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from ewscene import grass_plot as yard, paths

ASSETS = paths.assets_dir()
PH = ASSETS + "/polyhaven/"
TRUNK = PH + "dead_tree_trunk/1k/dead_tree_trunk_1k.blend"
END_GRAIN = ASSETS + "/openart/log-end-grain.png"
GRID_M = yard.GRID_M
RADIUS_M = 0.085
STOCK = 14
GAP_M = 0.004
BODY = 0.72  # a log's body radius as a share of its radius with the scan's knots and stubs
LENGTH_M = 0.92
PILE_SEED = 4117
TILE_M = 3.2
CELL_M = 0.03
AMP_M = 0.035
CLUMPS_PER_M2 = 220.0
STONES_PER_M2 = 0.5


def end_material():
    mat = bpy.data.materials.new("Log end grain")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    image = nt.nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(END_GRAIN)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs[0], image.inputs["Vector"])
    # The face darkens toward its rim, so a cut end sits back in shade against the bark.
    centre = nt.nodes.new("ShaderNodeVectorMath")
    centre.operation = "DISTANCE"
    centre.inputs[1].default_value = (0.5, 0.5, 0.0)
    nt.links.new(uv.outputs[0], centre.inputs[0])
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 0.24
    fade.inputs["From Max"].default_value = 0.46
    fade.inputs["To Min"].default_value = 1.0
    fade.inputs["To Max"].default_value = 0.78
    nt.links.new(centre.outputs["Value"], fade.inputs["Value"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.inputs["A"].default_value = (0.0, 0.0, 0.0, 1.0)
    nt.links.new(fade.outputs[0], shade.inputs["Factor"])
    nt.links.new(image.outputs["Color"], shade.inputs["B"])
    nt.links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    bump.inputs["Distance"].default_value = 0.004
    nt.links.new(image.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    return mat


def round_of(trunk, axis, rng, start, length):
    # One round of the scan: returns (vertices, faces, uvs, cap flags, radius) with its length along +Z, centred on its axis.
    bm = bmesh.new()
    bm.from_mesh(trunk.data)
    made = []
    for at, clear_outer in ((start, False), (start + length, True)):
        co = Vector((0.0, 0.0, 0.0))
        co[axis] = at
        # A saw never cuts square: each face leans a little.
        normal = Vector((rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09)))
        normal[axis] = 1.0
        cut = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=co, plane_no=normal, clear_inner=not clear_outer, clear_outer=clear_outer)
        made.append([g for g in cut["geom_cut"] if isinstance(g, bmesh.types.BMEdge)])
    caps = []
    for edges in made:
        live = [e for e in edges if e.is_valid]
        if live:
            caps += bmesh.ops.holes_fill(bm, edges=live, sides=0)["faces"]
    bm.verts.ensure_lookup_table()
    pts = [v.co.copy() for v in bm.verts]
    other = [i for i in range(3) if i != axis]
    cx, cy = sum(p[other[0]] for p in pts) / len(pts), sum(p[other[1]] for p in pts) / len(pts)
    radius = sorted(math.hypot(p[other[0]] - cx, p[other[1]] - cy) for p in pts)[int(len(pts) * 0.97)]
    mid = start + length / 2
    verts = [(v.co[other[0]] - cx, v.co[other[1]] - cy, v.co[axis] - mid) for v in bm.verts]
    layer = bm.loops.layers.uv.active
    cap_set = set(caps)
    faces, uvs, flags = [], [], []
    for face in bm.faces:
        faces.append([v.index for v in face.verts])
        is_cap = face in cap_set
        flags.append(is_cap)
        if is_cap:
            uvs.append([(0.5 + (l.vert.co[other[0]] - cx) / (2 * radius), 0.5 + (l.vert.co[other[1]] - cy) / (2 * radius)) for l in face.loops])
        else:
            uvs.append([tuple(l[layer].uv) for l in face.loops])
    bm.free()
    return verts, faces, uvs, flags, radius


def mesh_of(name, parts, material):
    mesh = bpy.data.meshes.new(name)
    verts, faces, uvs = [], [], []
    for v, f, u in parts:
        base = len(verts)
        verts += v
        faces += [[i + base for i in face] for face in f]
        uvs += u
    mesh.from_pydata(verts, [], faces)
    layer = mesh.uv_layers.new(name="UVMap")
    i = 0
    for loop_uvs in uvs:
        for uv in loop_uvs:
            layer.data[i].uv = uv
            i += 1
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.materials.append(material)
    mesh.update()
    return mesh


def place(stock, rng, x, y, z, target, depth):
    # Draws in the order the scene was first built with; the random stream must not change.
    verts, faces, uvs, flags, radius = stock
    s = target / radius
    along = min(depth * rng.uniform(0.82, 1.0), LENGTH_M * s) / LENGTH_M
    y = y + rng.uniform(-0.035, 0.035)
    spin, flip = rng.uniform(0, 2 * math.pi), rng.random() < 0.5
    turn = Matrix.Rotation(rng.uniform(0, 2 * math.pi), 2)
    mat = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.pi / 2 if flip else -math.pi / 2, 4, "X") @ Matrix.Rotation(spin, 4, "Z")
    moved = [tuple(mat @ Vector((a * s, b * s, h * along))) for a, b, h in verts]
    bark_f = [(f, u) for f, u, cap in zip(faces, uvs, flags) if not cap]
    cap_f = [(f, [tuple(Vector((0.5, 0.5)) + turn @ (Vector(p) - Vector((0.5, 0.5)))) for p in u]) for f, u, cap in zip(faces, uvs, flags) if cap]
    return (moved, [f for f, _ in bark_f], [u for _, u in bark_f]), (moved, [f for f, _ in cap_f], [u for _, u in cap_f])


def rebuild(hazard, stock, rng, bark_mat, ends_mat):
    main = bpy.data.objects[hazard]
    ends = bpy.data.objects[hazard + " log ends"]
    box = [Vector(c) for c in main.bound_box]
    x0, x1 = min(c.x for c in box), max(c.x for c in box)
    y0, y1 = min(c.y for c in box), max(c.y for c in box)
    z0, z1 = min(c.z for c in box), max(c.z for c in box)
    depth = y1 - y0
    bark_parts, cap_parts = [], []
    # Each log is dropped from above until it rests on the ground or on logs already placed; circles never overlap.
    placed = []
    spots = []
    for _ in range(14):
        x = x0 + RADIUS_M * rng.uniform(0.6, 1.2)
        while x < x1 - RADIUS_M * 0.6:
            spots.append(x)
            x += RADIUS_M * rng.uniform(1.5, 1.8)
    for x in spots + [None] * 12:
        round_stock = rng.choice(stock)
        if x is None:
            # Logs placed into any hole left below the stack's top, largest hole first.
            best = None
            top = max(oz for _, oz, _ in placed)
            for gx in range(1, 60):
                for gz in range(1, 40):
                    px, pz = x0 + (x1 - x0) * gx / 60, z0 + (top - z0) * gz / 40
                    room = min(math.hypot(ox - px, oz - pz) - orad for ox, oz, orad in placed)
                    if best is None or room > best[0]:
                        best = (room, px, pz)
            if best[0] < RADIUS_M * 0.55:
                continue
            room, x, z = best
            body = room - GAP_M
            target = body / BODY
        else:
            target = RADIUS_M * rng.uniform(0.95, 1.3)
            body = target * BODY
            z = z0 + body
            for ox, oz, orad in placed:
                reach = orad + body + GAP_M
                if abs(ox - x) < reach:
                    z = max(z, oz + math.sqrt(reach * reach - (ox - x) ** 2))
            if z + body > z1 + RADIUS_M * 0.4 or (z > z1 - RADIUS_M * 2.5 and rng.random() < 0.3):
                continue
        placed.append((x, z, body))
        bark, cap = place(round_stock, rng, x, y0 + depth / 2, z, target, depth)
        bark_parts.append(bark)
        cap_parts.append(cap)
    main.data = mesh_of(hazard + " scanned", bark_parts, bark_mat)
    ends.data = mesh_of(hazard + " scanned ends", cap_parts, ends_mat)
    print("EW_PILE", hazard, "rounds", len(bark_parts), "bark faces", len(main.data.polygons), "cap faces", len(ends.data.polygons), flush=True)


def build_piles():
    with bpy.data.libraries.load(TRUNK) as (src, dst):
        dst.objects = ["dead_tree_trunk"]
    trunk = dst.objects[0]
    bark_mat = trunk.data.materials[0]
    for im in bpy.data.images:
        if "dead_tree_trunk" in im.name and im.source == "FILE":
            im.filepath = os.path.join(ASSETS, "polyhaven/dead_tree_trunk/1k/textures", os.path.basename(im.filepath))
            im.reload()
    axis = max(range(3), key=lambda i: trunk.dimensions[i])
    coords = [v.co[axis] for v in trunk.data.vertices]
    low, high = min(coords), max(coords)
    rng = random.Random(PILE_SEED)
    stock = [round_of(trunk, axis, rng, rng.uniform(low + 0.05, high - LENGTH_M - 0.05), LENGTH_M) for _ in range(STOCK)]
    ends_mat = end_material()
    tree = bark_mat.node_tree
    base = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"]
    if base.is_linked:
        warm = tree.nodes.new("ShaderNodeMix")
        warm.data_type = "RGBA"
        warm.blend_type = "MULTIPLY"
        warm.inputs["Factor"].default_value = 1.0
        warm.inputs["B"].default_value = (1.5, 1.08, 0.72, 1.0)
        tree.links.new(base.links[0].from_socket, warm.inputs["A"])
        tree.links.new(warm.outputs["Result"], base)
    for name in [o.name for o in bpy.data.objects if o.get("ew_hazard_id", "").startswith("wood-pile") and o.type == "MESH" and not o.name.endswith("log ends")]:
        rebuild(name, stock, rng, bark_mat, ends_mat)


def tex(name, kind, res="4k", colour=False):
    im = bpy.data.images.load("%s%s/%s/%s_%s_%s.jpg" % (PH, name, res, name, kind, res), check_existing=True)
    im.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return im


def blur_noise(n, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n))
    for cells, weight in ((5, 1.0), (13, 0.55), (37, 0.3)):
        coarse = rng.random((cells + 1, cells + 1))
        at = np.linspace(0, cells - 1e-6, n)
        i = at.astype(int)
        t = at - i
        t = t * t * (3 - 2 * t)
        out += weight * ((coarse[i][:, i] * (1 - t)[:, None] + coarse[i + 1][:, i] * t[:, None]) * (1 - t)[None, :] + (coarse[i][:, i + 1] * (1 - t)[:, None] + coarse[i + 1][:, i + 1] * t[:, None]) * t[None, :])
    out -= out.min()
    return out / out.max()


def ground_material():
    mat = bpy.data.materials.new("Scanned yard")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / TILE_M, 1 / TILE_M, 1)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    far = nt.nodes.new("ShaderNodeMapping")
    far.inputs["Scale"].default_value = (1 / (TILE_M * 1.73), 1 / (TILE_M * 1.73), 1)
    far.inputs["Rotation"].default_value = (0, 0, 0.7)
    nt.links.new(coord.outputs["Object"], far.inputs["Vector"])

    def image(name, kind, vec, colour=False):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = tex(name, kind, colour=colour)
        nt.links.new(vec.outputs[0], node.inputs["Vector"])
        return node

    rocks = image("dry_ground_rocks", "diff", mapping, colour=True)
    soil = image("dry_ground_01", "diff", far, colour=True)
    rock_n = image("dry_ground_rocks", "nor_gl", mapping)
    soil_n = image("dry_ground_01", "nor_gl", far)
    rock_r = image("dry_ground_rocks", "rough", mapping)
    patch = nt.nodes.new("ShaderNodeTexNoise")
    patch.inputs["Scale"].default_value = 0.42
    patch.inputs["Detail"].default_value = 7.0
    nt.links.new(coord.outputs["Object"], patch.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.58
    nt.links.new(patch.outputs[0], ramp.inputs["Fac"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(ramp.outputs[0], mix.inputs["Factor"])
    nt.links.new(rocks.outputs[0], mix.inputs["A"])
    nt.links.new(soil.outputs[0], mix.inputs["B"])
    warm = nt.nodes.new("ShaderNodeMix")
    warm.data_type = "RGBA"
    warm.blend_type = "MULTIPLY"
    warm.inputs["Factor"].default_value = 1.0
    warm.inputs["B"].default_value = (1.15, 1.04, 0.88, 1)
    nt.links.new(mix.outputs["Result"], warm.inputs["A"])
    nt.links.new(warm.outputs["Result"], bsdf.inputs["Base Color"])
    nmix = nt.nodes.new("ShaderNodeMix")
    nmix.data_type = "RGBA"
    nt.links.new(ramp.outputs[0], nmix.inputs["Factor"])
    nt.links.new(rock_n.outputs[0], nmix.inputs["A"])
    nt.links.new(soil_n.outputs[0], nmix.inputs["B"])
    normal = nt.nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 1.4
    nt.links.new(nmix.outputs["Result"], normal.inputs["Color"])
    nt.links.new(normal.outputs[0], bsdf.inputs["Normal"])
    nt.links.new(rock_r.outputs[0], bsdf.inputs["Roughness"])
    return mat


def build_ground():
    x0, x1, y0, y1 = GRID_M
    nx, ny = int((x1 - x0) / CELL_M), int((y1 - y0) / CELL_M)
    disp = tex("dry_ground_rocks", "disp")
    w, h = disp.size
    pix = np.empty(w * h * 4, dtype=np.float32)
    disp.pixels.foreach_get(pix)
    height = pix[0::4].reshape(h, w)
    xs = np.linspace(x0, x1, nx + 1)
    ys = np.linspace(y0, y1, ny + 1)
    gx, gy = np.meshgrid(xs, ys)
    u = ((gx / TILE_M) % 1.0 * (w - 1)).astype(int)
    v = ((gy / TILE_M) % 1.0 * (h - 1)).astype(int)
    lumps = blur_noise(max(nx, ny) + 1, 7)[: ny + 1, : nx + 1]
    z = (height[v, u] - 0.5) * AMP_M + (lumps - 0.5) * 0.09 - 0.05
    verts = np.column_stack((gx.ravel(), gy.ravel(), z.ravel()))
    a = np.arange(ny * (nx + 1)).reshape(ny, nx + 1)[:, :-1].ravel()
    quads = np.column_stack((a, a + 1, a + nx + 2, a + nx + 1))
    mesh = bpy.data.meshes.new("Scanned yard")
    mesh.vertices.add(len(verts))
    mesh.vertices.foreach_set("co", verts.ravel())
    mesh.loops.add(quads.size)
    mesh.loops.foreach_set("vertex_index", quads.ravel())
    mesh.polygons.add(len(quads))
    mesh.polygons.foreach_set("loop_start", np.arange(0, quads.size, 4))
    mesh.polygons.foreach_set("use_smooth", np.ones(len(quads), dtype=bool))
    mesh.update()
    mesh.materials.append(ground_material())
    obj = bpy.data.objects.new("Scanned yard", mesh)
    bpy.context.scene.collection.objects.link(obj)
    print("EW_GROUND verts", len(verts), flush=True)
    return lambda px, py: float(z[min(ny, max(0, int((py - y0) / CELL_M)))][min(nx, max(0, int((px - x0) / CELL_M)))])


def load_model(name, res="2k"):
    path = "%s%s/%s/%s_%s.blend" % (PH, name, res, name, res)
    with bpy.data.libraries.load(path, relative=False) as (src, dst):
        dst.objects = list(src.objects)
    return [o for o in dst.objects if o and o.type == "MESH"]


def straw(mat):
    # Dead straw from the scan's own dead-grass colour map, which replaces the green one on the shader group's input.
    tree = mat.node_tree
    dry = next((n for n in tree.nodes if n.type == "TEX_IMAGE" and n.image and "dry_diff" in n.image.filepath), None)
    group = next((n for n in tree.nodes if n.type == "GROUP"), None)
    if group is None or "Dead Amount" not in group.inputs:
        return
    # Each clump dies by its own amount, so the cover is not one flat yellow.
    info = tree.nodes.new("ShaderNodeObjectInfo")
    vary = tree.nodes.new("ShaderNodeMapRange")
    vary.inputs["To Min"].default_value = 0.72
    vary.inputs["To Max"].default_value = 1.0
    tree.links.new(info.outputs["Random"], vary.inputs["Value"])
    tree.links.new(vary.outputs[0], group.inputs["Dead Amount"])
    if dry is not None:
        lift = tree.nodes.new("ShaderNodeMix")
        lift.data_type = "RGBA"
        lift.blend_type = "MULTIPLY"
        lift.inputs["Factor"].default_value = 1.0
        lift.inputs["B"].default_value = (2.3, 2.2, 1.85, 1)
        tree.links.new(dry.outputs[0], lift.inputs["A"])
        pale = tree.nodes.new("ShaderNodeHueSaturation")
        pale.inputs["Saturation"].default_value = 0.56
        pale.inputs["Value"].default_value = 0.86
        tree.links.new(lift.outputs["Result"], pale.inputs["Color"])
        tree.links.new(pale.outputs[0], group.inputs["Diffuse Dead"])
    print("EW_DRY", mat.name, flush=True)


def scatter(name, sources, density, scale_range, seed, height_at, keep, mask=None):
    scene = bpy.context.scene
    holder = bpy.data.collections.new(name + " sources")
    scene.collection.children.link(holder)
    holder.hide_render = False
    holder.hide_viewport = False
    for o in sources:
        holder.objects.link(o)
        o.hide_render = True
        o.location = (0, 0, -40)
    rng = random.Random(seed)
    x0, x1, y0, y1 = GRID_M
    points = []
    for _ in range(int((x1 - x0) * (y1 - y0) * density)):
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if yard.blocked(keep, x, y) or (mask is not None and rng.random() > mask(x, y)):
            continue
        points.append((x, y, height_at(x, y) - 0.005))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], [])
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    mod = obj.modifiers.new(name, "NODES")
    tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = tree.nodes
    start, end = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    info = n.new("GeometryNodeCollectionInfo")
    info.inputs["Collection"].default_value = holder
    info.inputs["Separate Children"].default_value = True
    info.inputs["Reset Children"].default_value = True
    put = n.new("GeometryNodeInstanceOnPoints")
    put.inputs["Pick Instance"].default_value = True
    tree.links.new(start.outputs[0], put.inputs["Points"])
    tree.links.new(info.outputs[0], put.inputs["Instance"])
    pick = n.new("FunctionNodeRandomValue")
    pick.data_type = "INT"
    pick.inputs["Min"].default_value = 0
    pick.inputs["Max"].default_value = 9999
    pick.inputs["Seed"].default_value = seed
    tree.links.new(pick.outputs["Value"], put.inputs["Instance Index"])
    spin = n.new("FunctionNodeRandomValue")
    spin.data_type = "FLOAT_VECTOR"
    spin.inputs["Min"].default_value = (-0.42, -0.42, 0)
    spin.inputs["Max"].default_value = (0.42, 0.42, 6.283)
    spin.inputs["Seed"].default_value = seed + 1
    tree.links.new(spin.outputs["Value"], put.inputs["Rotation"])
    size = n.new("FunctionNodeRandomValue")
    size.data_type = "FLOAT"
    size.inputs["Min"].default_value = scale_range[0]
    size.inputs["Max"].default_value = scale_range[1]
    size.inputs["Seed"].default_value = seed + 2
    tree.links.new(size.outputs["Value"], put.inputs["Scale"])
    tree.links.new(put.outputs[0], end.inputs[0])
    mod.node_group = tree
    print("EW_SCATTER", name, len(points), flush=True)


def darken_branches():
    # The dead branch scans read too dark against the pale yard.
    for mat in bpy.data.materials:
        if not (mat.use_nodes and "dry_branches" in mat.name):
            continue
        tree = mat.node_tree
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None and bsdf.inputs["Base Color"].is_linked:
            up = tree.nodes.new("ShaderNodeMix")
            up.data_type = "RGBA"
            up.blend_type = "MULTIPLY"
            up.inputs["Factor"].default_value = 1.0
            up.inputs["B"].default_value = (1.25, 1.15, 1.02, 1)
            tree.links.new(bsdf.inputs["Base Color"].links[0].from_socket, up.inputs["A"])
            tree.links.new(up.outputs["Result"], bsdf.inputs["Base Color"])


def warm_log_ends():
    # Wood-brown ends: the texture's own colour, darker and warmer so sun does not bleach it.
    mat = bpy.data.materials.get("Log end grain")
    if mat is None:
        return
    tree = mat.node_tree
    for n in tree.nodes:
        if n.type == "MAP_RANGE":
            n.inputs["To Min"].default_value = 0.62
            n.inputs["To Max"].default_value = 0.42
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    warm = tree.nodes.new("ShaderNodeMix")
    warm.data_type = "RGBA"
    warm.blend_type = "MULTIPLY"
    warm.inputs["Factor"].default_value = 1.0
    warm.inputs["B"].default_value = (1.08, 0.86, 0.62, 1)
    tree.links.new(bsdf.inputs["Base Color"].links[0].from_socket, warm.inputs["A"])
    tree.links.new(warm.outputs["Result"], bsdf.inputs["Base Color"])


def light():
    scene = bpy.context.scene
    data = bpy.data.lights.new("Low sun", "SUN")
    data.energy = 14.0
    data.color = (1.0, 0.82, 0.6)
    data.angle = math.radians(0.8)
    sun = bpy.data.objects.new("Low sun", data)
    scene.collection.objects.link(sun)
    # Low in the west south west, about 22 degrees up, so the west and south walls take the light.
    sun.rotation_euler = (math.radians(58), 0, math.radians(-75))
    for name in ("Fill sun", "Fill sun back"):
        bpy.data.objects[name].data.energy = 0.8
    for n in scene.world.node_tree.nodes:
        if n.type == "BACKGROUND":
            n.inputs["Strength"].default_value *= 1.35
    comp = getattr(scene, "compositing_node_group", None) or getattr(scene, "node_tree", None)
    thinned = 0
    if comp is not None:
        for n in comp.nodes:
            if n.type == "MATH":
                for sock in n.inputs:
                    if sock.type == "VALUE" and not sock.is_linked and -0.01 < sock.default_value < 0:
                        sock.default_value *= 0.3
                        thinned += 1
    print("EW_HAZE thinned", thinned, flush=True)


def siding():
    tree = bpy.data.materials["Siding paint"].node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    grain = tree.nodes.new("ShaderNodeTexWave")
    grain.bands_direction = "Z"
    grain.inputs["Scale"].default_value = 60.0
    grain.inputs["Distortion"].default_value = 6.0
    grain.inputs["Detail"].default_value = 6.0
    tree.links.new(coord.outputs["Object"], grain.inputs["Vector"])
    fine = tree.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 500.0
    fine.inputs["Detail"].default_value = 5.0
    tree.links.new(coord.outputs["Object"], fine.inputs["Vector"])
    add = tree.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 0.4
    tree.links.new(fine.outputs[0], add.inputs[0])
    tree.links.new(grain.outputs[0], add.inputs[2])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0015
    tree.links.new(add.outputs[0], bump.inputs["Height"])
    old = bsdf.inputs["Normal"].links[0].from_socket if bsdf.inputs["Normal"].is_linked else None
    if old is not None:
        tree.links.new(old, bump.inputs["Normal"])
    tree.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    if bsdf.inputs["Base Color"].is_linked:
        taupe = tree.nodes.new("ShaderNodeMix")
        taupe.data_type = "RGBA"
        taupe.blend_type = "MULTIPLY"
        taupe.inputs["Factor"].default_value = 1.0
        taupe.inputs["B"].default_value = (0.68, 0.645, 0.63, 1)
        tree.links.new(bsdf.inputs["Base Color"].links[0].from_socket, taupe.inputs["A"])
        tree.links.new(taupe.outputs["Result"], bsdf.inputs["Base Color"])
    laps = bpy.data.objects.get("House siding laps")
    if laps is not None:
        laps.scale = (1, 1, 1)
        mod = laps.modifiers.new("depth", "SOLIDIFY")
        mod.thickness = 0.014
        mod.offset = 1.0
    trim = bpy.data.objects.get("Corner trim")
    if trim is not None:
        mod = trim.modifiers.new("depth", "SOLIDIFY")
        mod.thickness = 0.04
        mod.offset = 1.0


def windows():
    tree = bpy.data.materials["Window glass"].node_tree
    for n in list(tree.nodes):
        if n.type != "OUTPUT_MATERIAL":
            tree.nodes.remove(n)
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.03, 0.035, 0.035, 1)
    bsdf.inputs["Roughness"].default_value = 0.03
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.9
    tree.links.new(bsdf.outputs[0], out.inputs["Surface"])
    for o in bpy.data.objects:
        if o.name.startswith("Window") and o.name.endswith("frame"):
            mod = o.modifiers.new("depth", "SOLIDIFY")
            mod.thickness = 0.05
            mod.offset = 0.0
        if o.name.startswith("Window") and o.name.endswith("room"):
            o.hide_render = True


def grade():
    v = bpy.context.scene.view_settings
    v.view_transform = "AgX"
    try:
        v.look = "AgX - Medium High Contrast"
    except TypeError as e:
        print("EW_LOOK", e, flush=True)
    v.exposure = 0.75


def main():
    parser = argparse.ArgumentParser(prog="final_look.py", description="Rebuild the wood piles, near ground, grass, sun, siding and windows on the hero scene and save a copy.")
    parser.add_argument("--spec", required=True, help="the house spec")
    parser.add_argument("--out", required=True, help="where the .blend copy is saved")
    args = parser.parse_args(paths.script_args())
    started = time.monotonic()
    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)
    keep = yard.keepouts(spec)
    paths.relink(bpy.data, ASSETS)
    build_piles()
    darken_branches()
    warm_log_ends()
    height_at = build_ground()
    if "Ground cover" in bpy.data.objects:
        bpy.data.objects["Ground cover"].hide_render = True
    light()
    siding()
    windows()
    grade()
    grasses = []
    for name in ("grass_medium_01", "grass_medium_02"):
        grasses += [o for o in load_model(name) if ("tall" in o.name or "mid" in o.name or "large" in o.name) and "geonodes" not in o.name and ("LOD" not in o.name or "LOD0" in o.name)]
    done = set()
    for o in grasses:
        for mat in o.data.materials:
            if mat and mat.name not in done:
                done.add(mat.name)
                straw(mat)
    patchy = blur_noise(512, 3)
    x0, x1, y0, y1 = GRID_M

    def thick(x, y):
        return yard.thickness(patchy[int((y - y0) / (y1 - y0) * 511)][int((x - x0) / (x1 - x0) * 511)])

    scatter("Dry grass", grasses, CLUMPS_PER_M2, (0.75, 1.8), 11, height_at, keep, thick)
    stones = [o for o in load_model("sand_rocks_small_01") if "LOD3" in o.name]
    scatter("Small stones", stones, STONES_PER_M2, (0.015, 0.06), 21, height_at, keep)
    if os.path.isdir(PH + "bark_debris_01/1k"):
        scatter("Bark and sticks", load_model("bark_debris_01", "1k"), 0.25, (0.6, 1.2), 31, height_at, keep)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.out, copy=True)
    print("EW_FINAL_LOOK %s in %.1f s" % (args.out, time.monotonic() - started))


main()
