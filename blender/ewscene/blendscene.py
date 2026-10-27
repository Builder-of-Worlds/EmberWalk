import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import geom, placement
from .units import in_to_m

HOUSE_DEPTH_IN = 360
ROOF_RISE_IN = 54
EAVE_IN = 14
HAZARD_TAG = "ew_hazard_id"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _mesh_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return _link(bpy.data.objects.new(name, mesh))


def _box(bm, lo, hi):
    lo_m, hi_m = Vector([in_to_m(v) for v in lo]), Vector([in_to_m(v) for v in hi])
    size = hi_m - lo_m
    centre = (lo_m + hi_m) / 2
    m = Matrix.Translation(centre) @ Matrix.Diagonal((size.x, size.y, size.z, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def pbr_material(name, manifest):
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    w, h = manifest.get("size_m", [2.0, 2.0])
    mapping.inputs["Scale"].default_value = (1.0 / w, 1.0 / h, 1.0 / w)
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def image(key, colour):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(manifest["files"][key], check_existing=True)
        tex.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        tex.projection = "BOX"
        tex.projection_blend = 0.2
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        return tex

    links.new(image("Diffuse", True).outputs["Color"], bsdf.inputs["Base Color"])
    links.new(image("Rough", False).outputs["Color"], bsdf.inputs["Roughness"])
    normal = nodes.new("ShaderNodeNormalMap")
    links.new(image("nor_gl", False).outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def world(manifest, rotation_deg):
    w = bpy.data.worlds.new("Captured sky")
    bpy.context.scene.world = w
    nodes, links = w.node_tree.nodes, w.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(manifest["files"]["hdri"], check_existing=True)
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rotation_deg))
    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    links.new(env.outputs["Color"], nodes["Background"].inputs["Color"])
    w.use_sun_shadow = True
    w.sun_threshold = 5.0
    w.sun_angle = math.radians(1.0)


def house(spec, materials):
    length, height = spec["wall"]["length_in"], spec["wall"]["height_in"]
    bm = bmesh.new()
    _box(bm, (0, -HOUSE_DEPTH_IN, 0), (length, 0, height))
    body = _mesh_object("House wall", bm)
    body.data.materials.append(materials[spec["wall"]["material"]])
    body["ew_role"] = "wall"

    bm = bmesh.new()
    y0, y1, ridge = -HOUSE_DEPTH_IN - EAVE_IN, EAVE_IN, -HOUSE_DEPTH_IN / 2.0
    pts = [(y0, height), (ridge, height + ROOF_RISE_IN), (y1, height)]
    verts = []
    for x in (-EAVE_IN, length + EAVE_IN):
        verts.append([bm.verts.new((in_to_m(x), in_to_m(y), in_to_m(z))) for y, z in pts])
    a, b = verts
    bm.faces.new((a[0], a[1], b[1], b[0]))
    bm.faces.new((a[1], a[2], b[2], b[1]))
    bm.faces.new((a[2], a[1], a[0]))
    bm.faces.new((b[0], b[1], b[2]))
    roof = _mesh_object("Roof", bm)
    roof.data.materials.append(materials[spec["wall"]["roof_material"]])


def ground(spec, materials):
    length, depth = spec["wall"]["length_in"], spec["ground"]["depth_in"]
    bm = bmesh.new()
    lo = (in_to_m(-1200), in_to_m(-HOUSE_DEPTH_IN - 600), 0.0)
    hi = (in_to_m(length + 1200), in_to_m(depth), 0.0)
    corners = [(lo[0], lo[1], 0), (hi[0], lo[1], 0), (hi[0], hi[1], 0), (lo[0], hi[1], 0)]
    bm.faces.new([bm.verts.new(c) for c in corners])
    obj = _mesh_object("Ground", bm)
    obj.data.materials.append(materials[spec["ground"]["material"]])


def _wood_pile(size, rng):
    w, d, h = size
    radius = 3.5
    bm = bmesh.new()
    cols, rows = max(1, int(w // (2 * radius))), max(1, int(h // (1.8 * radius)))
    for r in range(rows):
        shift = radius if r % 2 else 0.0
        for c in range(cols - (1 if r % 2 else 0)):
            rad = radius * rng.uniform(0.82, 1.0)
            length = d * rng.uniform(0.94, 1.0)
            x = shift + (c + 0.5) * 2 * radius
            z = radius + r * 1.8 * radius
            m = Matrix.Translation((in_to_m(x), in_to_m(length / 2), in_to_m(z))) @ Matrix.Rotation(math.pi / 2, 4, "X")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=in_to_m(rad), radius2=in_to_m(rad), depth=in_to_m(length), matrix=m)
    return bm


def _wood_fence(size, rng):
    w, d, h = size
    bm = bmesh.new()
    posts = max(2, int(d // 96) + 1)
    for i in range(posts):
        y = min(i * 96, d - 4)
        _box(bm, (0, y, 0), (3.5, y + 3.5, h))
    for z in (10, h - 14):
        _box(bm, (0.5, 0, z), (3.0, d, z + 3.5))
    y = 0.0
    while y + 5.5 <= d:
        top = h - rng.uniform(0, 1.5)
        _box(bm, (3.0, y, 1.0), (w, y + 5.5, top))
        y += 5.75
    return bm


SCRIPTED = {"scripted:wood_pile": _wood_pile, "scripted:wood_fence": _wood_fence}


def _append_model(path):
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o is not None and o.type == "MESH"]
    for o in objs:
        mw = o.matrix_world.copy()
        _link(o)
        o.parent = None
        o.matrix_world = mw
    return objs


def world_bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for o in objs:
        ev = o.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        for v in mesh.vertices:
            p = mw @ v.co
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
        ev.to_mesh_clear()
    return lo, hi


def _fit(root, objs, box_in):
    bpy.context.view_layer.update()
    lo, hi = world_bounds(objs)
    target_lo = [in_to_m(v) for v in box_in[0]]
    target_hi = [in_to_m(v) for v in box_in[1]]
    scale = [(target_hi[i] - target_lo[i]) / (hi[i] - lo[i]) for i in range(3)]
    root.scale = scale
    root.location = [target_lo[i] - scale[i] * lo[i] for i in range(3)]
    bpy.context.view_layer.update()


def hazards(spec, catalog, materials, manifests):
    for h in spec["hazards"]:
        rng = random.Random(h["id"])
        entry = catalog[h["asset"]]
        if entry["kind"] == "scripted":
            obj = _mesh_object(h["id"], SCRIPTED[h["asset"]](h["size_in"], rng))
            obj.data.materials.append(materials[entry["material"]])
            objs = [obj]
        else:
            objs = _append_model(manifests[h["asset"]]["files"]["blend"])
        root = _link(bpy.data.objects.new(h["id"] + " root", None))
        root[HAZARD_TAG] = h["id"]
        parts = _cluster(objs, entry.get("cluster", 1), rng)
        meshes = []
        for part, members in parts:
            part.parent = root
            meshes.extend(members)
        for o in meshes:
            o[HAZARD_TAG] = h["id"]
        _fit(root, meshes, placement.hazard_box(h))


def _cluster(objs, count, rng):
    parts = []
    for k in range(count):
        part = _link(bpy.data.objects.new("part %d" % k, None))
        members = objs if k == 0 else [_link(o.copy()) for o in objs]
        for o in members:
            o.parent = part
        if count > 1:
            part.rotation_euler = (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, 2 * math.pi))
            part.scale = [rng.uniform(0.7, 1.1)] * 3
            part.location = (rng.uniform(-0.35, 0.35), rng.uniform(-0.25, 0.25), rng.uniform(0, 0.2))
        parts.append((part, members))
    return parts


def camera(motion):
    cam = motion["camera"]
    data = bpy.data.cameras.new("Phone")
    data.lens = cam["focal_mm"]
    data.sensor_fit = "HORIZONTAL"
    data.sensor_width = cam["sensor_width_mm"]
    data.clip_start = 0.05
    data.clip_end = 600.0
    obj = _link(bpy.data.objects.new("Phone", data))
    obj.rotation_mode = "QUATERNION"
    bpy.context.scene.camera = obj
    prev = None
    for s in motion["samples"]:
        q = Matrix(geom.camera_rotation(s["heading_deg"], s["tilt_deg"], s["roll_deg"])).to_quaternion()
        if prev is not None and q.dot(prev) < 0:
            q.negate()
        prev = q
        obj.location = [in_to_m(v) for v in s["pos_in"]]
        obj.rotation_quaternion = q
        obj.keyframe_insert("location", frame=s["frame"])
        obj.keyframe_insert("rotation_quaternion", frame=s["frame"])
    return obj


def render_settings(spec, samples):
    scene = bpy.context.scene
    walk = spec["walk"]
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = samples
    scene.render.resolution_x = walk["width_px"]
    scene.render.resolution_y = walk["height_px"]
    scene.render.resolution_percentage = 100
    scene.render.fps = walk["fps"]
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = walk["duration_s"] * walk["fps"]
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    im = scene.render.image_settings
    im.media_type = "VIDEO"
    im.file_format = "FFMPEG"
    ff = scene.render.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "HIGH"
    ff.ffmpeg_preset = "GOOD"
    ff.gopsize = walk["fps"]
    ff.audio_codec = "NONE"
    scene["ew_label"] = spec["label"]


def build(spec, catalog, manifests, motion, samples=16):
    reset()
    bpy.context.scene.unit_settings.system = "IMPERIAL"
    materials = {}
    for asset_id, man in manifests.items():
        if man["kind"] == "texture":
            materials[asset_id] = pbr_material(asset_id.split(":", 1)[1], man)
    world(manifests[spec["light"]["hdri"]], spec["light"]["rotation_deg"])
    house(spec, materials)
    ground(spec, materials)
    hazards(spec, catalog, materials, manifests)
    camera(motion)
    render_settings(spec, samples)
