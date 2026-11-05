import math
import os

import bpy

from . import paths

PH = os.path.join(paths.assets_dir(), "polyhaven", "")
DECK_OBJECTS = ("back-deck", "back-deck-steps")
VENT_HEAP = ("vent-debris-right", "vent-debris-right dry leaves")
DOORS = tuple(os.environ.get("EW_DOORS", "Back door,Front door").split(","))


def image(path, colour):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return im


def tint(tree, bsdf, rgb):
    src = bsdf.inputs["Base Color"].links[0].from_socket
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = rgb + (1.0,)
    tree.links.new(src, mix.inputs["A"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


def decking():
    mat = bpy.data.materials.new("Deck boards")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.45, 0.45, 0.45)
    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    for kind, socket, colour in (("diff", "Base Color", True), ("rough", "Roughness", False)):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image("%sweathered_planks/1k/weathered_planks_%s_1k.jpg" % (PH, kind), colour)
        tree.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        tree.links.new(node.outputs["Color"], bsdf.inputs[socket])
    normal = tree.nodes.new("ShaderNodeTexImage")
    normal.image = image(PH + "weathered_planks/1k/weathered_planks_nor_gl_1k.jpg", False)
    tree.links.new(mapping.outputs["Vector"], normal.inputs["Vector"])
    nmap = tree.nodes.new("ShaderNodeNormalMap")
    tree.links.new(normal.outputs["Color"], nmap.inputs["Color"])
    tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    tint(tree, bsdf, (0.62, 0.64, 0.68))
    return mat


def swap_deck():
    for name in DECK_OBJECTS:
        o = bpy.data.objects.get(name)
        if o is not None:
            o.data.materials.clear()
            o.data.materials.append(bpy.data.materials.get("Deck boards") or decking())
    for name in DOORS:
        swap_door(name)
    if os.environ.get("EW_GRASS") == "soft" or os.path.isfile(os.path.join(os.path.dirname(bpy.data.filepath), "grass.on")):
        soften_grass("tall-grass-back")
    if os.environ.get("EW_VENT") == "low" or os.path.isfile(os.path.join(os.path.dirname(bpy.data.filepath), "vent.low")):
        lower_vent_heap()
    if os.environ.get("EW_TANK") == "stand" or os.path.isfile(os.path.join(os.path.dirname(bpy.data.filepath), "tank.stand")):
        stand_propane_tank()


def stand_propane_tank():
    mesh, fit = bpy.data.objects.get("propane-tank-right"), bpy.data.objects.get("propane-tank-right fit")
    if mesh is None or fit is None:
        return
    mesh.rotation_euler = (0.0, 0.0, mesh.rotation_euler.z)
    fit.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()
    low = min((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
    fit.location.z -= low
    bpy.context.view_layer.update()


def lower_vent_heap(factor=0.5):
    for name in VENT_HEAP:
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        to_world, to_local = o.matrix_world, o.matrix_world.inverted()
        for v in o.data.vertices:
            w = to_world @ v.co
            w.z *= factor
            v.co = to_local @ w
        o.data.update()


def _wobble(x, y):
    return 0.5 + 0.25 * math.sin(1.3 * x + 0.7) + 0.15 * math.sin(2.9 * y + 1.1) + 0.1 * math.sin(4.3 * x + 3.7 * y)


def soften_grass(name, reach=1.4, jag=0.7):
    import bmesh
    o = bpy.data.objects.get(name)
    if o is None:
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    seen, drop = set(), []
    for start in bm.verts:
        if start.index in seen:
            continue
        blade, stack = [], [start]
        seen.add(start.index)
        while stack:
            v = stack.pop()
            blade.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        base = min(blade, key=lambda v: v.co.z)
        d = min(base.co.x - x0, x1 - base.co.x, base.co.y - y0, y1 - base.co.y)
        edge = jag * _wobble(base.co.x, base.co.y)
        if d < edge - 0.2:
            drop.extend(blade)
            continue
        t = max(0.0, min(1.0, (d - edge) / reach))
        f = 0.2 + 0.8 * t * t * (3 - 2 * t)
        for v in blade:
            v.co.z = base.co.z + (v.co.z - base.co.z) * f
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    for mat in o.data.materials:
        if mat and mat.use_nodes:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is not None and bsdf.inputs["Base Color"].is_linked:
                tint(mat.node_tree, bsdf, (0.8, 0.76, 0.66))


HOUSE_CENTRE = (9.144, 9.906)
DOOR_HALF = 0.457
DOOR_PANELS_U = ((-0.347, -0.05), (0.05, 0.347))
DOOR_PANELS_V = ((0.18, 0.68), (0.80, 1.30), (1.42, 1.92))
TRIM_W = 0.095
SLAB_T = 0.065
PANEL_DEPTH = 0.035
DOOR_OUT = 0.05


def door_wood(thin_axis):
    mat = bpy.data.materials.new("Door wood")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (math.pi / 2, 0.0, 0.0) if thin_axis == 1 else (0.0, math.pi / 2, 0.0)
    mapping.inputs["Scale"].default_value = (0.7, 0.7, 0.7)
    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tex = {}
    for kind, colour in (("diff", True), ("rough", False), ("nor_gl", False)):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image("%sweathered_planks/1k/weathered_planks_%s_1k.jpg" % (PH, kind), colour)
        tree.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        tex[kind] = node
    tree.links.new(tex["diff"].outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(tex["rough"].outputs["Color"], bsdf.inputs["Roughness"])
    nmap = tree.nodes.new("ShaderNodeNormalMap")
    tree.links.new(tex["nor_gl"].outputs["Color"], nmap.inputs["Color"])
    tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    tint(tree, bsdf, (2.3, 1.55, 1.05))
    wear = tree.nodes.new("ShaderNodeTexNoise")
    wear.inputs["Scale"].default_value = 6.0
    wear.inputs["Detail"].default_value = 8.0
    tree.links.new(coord.outputs["Object"], wear.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.55, 0.5, 0.46, 1)
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    tree.links.new(wear.outputs["Fac"], ramp.inputs["Fac"])
    base = bsdf.inputs["Base Color"].links[0].from_socket
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    tree.links.new(base, mix.inputs["A"])
    tree.links.new(ramp.outputs["Color"], mix.inputs["B"])
    tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def hardware():
    mat = bpy.data.materials.new("Door hardware")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.42, 0.3, 0.17, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.32
    return mat


def swap_door(name):
    import bmesh
    from mathutils import Matrix, Vector
    o = bpy.data.objects.get(name)
    knob = bpy.data.objects.get(name + " knob")
    if o is None:
        return
    box = [Vector(v.co) for v in o.data.vertices]
    lo = Vector((min(v.x for v in box), min(v.y for v in box), min(v.z for v in box)))
    hi = Vector((max(v.x for v in box), max(v.y for v in box), max(v.z for v in box)))
    thin = 0 if hi.x - lo.x < hi.y - lo.y else 1
    centre = (lo + hi) / 2
    away = (centre.x - HOUSE_CENTRE[0], centre.y - HOUSE_CENTRE[1])[thin]
    n = Vector((1.0, 0.0, 0.0) if thin == 0 else (0.0, 1.0, 0.0)) * (1 if away > 0 else -1)
    up = Vector((0.0, 0.0, 1.0))
    u = up.cross(n)
    face = (hi if away > 0 else lo)[thin]
    origin = Vector(centre)
    origin[thin] = face + (DOOR_OUT if away > 0 else -DOOR_OUT)
    origin.z = lo.z

    def at(a, b, depth=0.0):
        return origin + u * a + up * b + n * depth

    def box(bm, a0, a1, b0, b1, d0, d1):
        corners = [at(a, b, d) for d in (d0, d1) for b in (b0, b1) for a in (a0, a1)]
        bmesh.ops.convex_hull(bm, input=[bm.verts.new(c) for c in corners])

    slab = bmesh.new()
    top = 2.032
    box(slab, -DOOR_HALF, DOOR_HALF, 0.0, top, -SLAB_T, -PANEL_DEPTH)
    for a0, a1 in ((-DOOR_HALF, DOOR_PANELS_U[0][0]), (DOOR_PANELS_U[0][1], DOOR_PANELS_U[1][0]), (DOOR_PANELS_U[1][1], DOOR_HALF)):
        box(slab, a0, a1, 0.0, top, -SLAB_T, 0.0)
    for b0, b1 in ((0.0, DOOR_PANELS_V[0][0]), (DOOR_PANELS_V[0][1], DOOR_PANELS_V[1][0]), (DOOR_PANELS_V[1][1], DOOR_PANELS_V[2][0]), (DOOR_PANELS_V[2][1], top)):
        box(slab, -DOOR_HALF, DOOR_HALF, b0, b1, -SLAB_T, 0.0)
    for (a0, a1) in DOOR_PANELS_U:
        for (b0, b1) in DOOR_PANELS_V:
            m = 0.03
            box(slab, a0, a0 + m, b0, b1, -PANEL_DEPTH, -0.012)
            box(slab, a1 - m, a1, b0, b1, -PANEL_DEPTH, -0.012)
            box(slab, a0, a1, b0, b0 + m, -PANEL_DEPTH, -0.012)
            box(slab, a0, a1, b1 - m, b1, -PANEL_DEPTH, -0.012)
    o.data.clear_geometry()
    slab.to_mesh(o.data)
    slab.free()
    o.data.materials.clear()
    o.data.materials.append(bpy.data.materials.get("Door wood") or door_wood(thin))

    trim = bpy.data.materials.get("Trim paint")
    parts = bmesh.new()

    def board(a0, a1, b0, b1, d0, d1):
        box(parts, a0, a1, b0, b1, d0, d1)

    half = DOOR_HALF
    board(-half - TRIM_W, -half, 0.0, 2.032 + TRIM_W, -0.03, 0.03)
    board(half, half + TRIM_W, 0.0, 2.032 + TRIM_W, -0.03, 0.03)
    board(-half - TRIM_W, half + TRIM_W, 2.032, 2.032 + TRIM_W, -0.03, 0.03)
    board(-half - 0.02, half + 0.02, -0.025, 0.0, -0.03, 0.07)
    trim_mesh = bpy.data.meshes.new(name + " trim")
    parts.to_mesh(trim_mesh)
    parts.free()
    trim_obj = bpy.data.objects.new(name + " trim", trim_mesh)
    o.users_collection[0].objects.link(trim_obj)
    trim_mesh.materials.append(trim)

    if knob is not None:
        hw = bmesh.new()
        for (a, b, radius, depth, out) in ((0.36, 1.0, 0.034, 0.012, 0.0), (0.36, 1.22, 0.026, 0.02, 0.0)):
            bmesh.ops.create_cone(hw, cap_ends=True, segments=24, radius1=radius, radius2=radius, depth=depth,
                                  matrix=Matrix.Translation(at(a, b, out + depth / 2)) @ _face_matrix(u, up, n))
        lever = [at(0.36 + dx, 1.0 + dy, d) for dx in (-0.025, 0.115) for dy in (-0.011, 0.011) for d in (0.012, 0.04)]
        bmesh.ops.convex_hull(hw, input=[hw.verts.new(c) for c in lever])
        hw.to_mesh(knob.data)
        hw.free()
        knob.data.materials.clear()
        knob.data.materials.append(bpy.data.materials.get("Door hardware") or hardware())


def _face_matrix(u, up, n):
    from mathutils import Matrix
    return Matrix(((u.x, up.x, n.x, 0), (u.y, up.y, n.y, 0), (u.z, up.z, n.z, 0), (0, 0, 0, 1)))
