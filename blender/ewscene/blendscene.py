import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import numpy

from . import downspout, engine, fence, geom, house as house_spec, laps, meadow, output, photomodel, photoscan, placement, route, woods, yard
from .units import in_to_m, m_to_in

HOUSE_DEPTH_IN = 360
ROOF_RISE_IN = 54
EAVE_IN = 14
HAZARD_TAG = "ew_hazard_id"
TREE_TAG = "ew_tree_id"
PHOTO_TAG = "ew_photoscan"
CROWN_LOW = 0.22
TIER_IN = 32
OAK_FORK = (0.14, 0.2)
TREE_STRETCH = (0.85, 1.2)
ROOF_TILE_M = 2.5
LAPPED_NORMAL = 0.12
BAND_START = 0.8
BAND_SHADE = 0.5
SHINGLE_NORMAL = 1.3
SHINGLE_ROUGH = 0.92
SHINGLE_SPECULAR = 0.12
SUPPORT_CANOPY_IN = 320
SUPPORT_RISE_IN = 230
MEADOW_TONES = ("#b0a283", "#bcaf92", "#c8bda3", "#9f9479", "#8d836c", "#73694f", "#6d7a40")
HAZE_SKY_M = 3000.0
BLADE_HALF_IN = 0.17
LOG_RADIUS_IN = 3.2
LOG_SIDES = 9
COPY_SHRINK = 0.14
FILL_TRAVEL = (-0.5, 0.45, -0.7)
FILL_COLOUR = (0.92, 0.95, 1.0)
PHOTO_VIEW = ("Khronos PBR Neutral", "Standard")
BRANCH_TWIGS = 16
BRANCH_TIP_LEAVES = 90
WOODS_PAD_IN = 4800
BED_RISE_IN = 0.6
WALK_RISE_IN = 0.5
GROUND_NOISE_M = (0.16, 0.55)
GROUND_EDGE_MID = 0.62
GROUND_EDGE_SPAN = 0.4
GROUND_EDGE_SOFT = 0.04


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    photomodel.reset()


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


def node_owner(owner):
    if not owner.use_nodes:
        owner.use_nodes = True
    return owner


def pbr_material(name, manifest, tint=None):
    mat = node_owner(bpy.data.materials.new(name))
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

    colour = image("Diffuse", True).outputs["Color"]
    if tint:
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (tint[0], tint[1], tint[2], 1.0)
        links.new(colour, mix.inputs[6])
        colour = mix.outputs[2]
    links.new(colour, bsdf.inputs["Base Color"])
    links.new(image("Rough", False).outputs["Color"], bsdf.inputs["Roughness"])
    normal = nodes.new("ShaderNodeNormalMap")
    links.new(image("nor_gl", False).outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _warm(nodes, links, env, light, warm):
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    mix.inputs[7].default_value = (warm[0], warm[1], warm[2], 1.0)
    links.new(env.outputs["Color"], mix.inputs[6])
    links.new(mix.outputs[2], light.inputs["Color"])


def haze_pass(scene, haze):
    scene.view_layers[0].use_pass_z = True
    group = bpy.data.node_groups.new("Haze", "CompositorNodeTree")
    group.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes, links = group.nodes, group.links
    layers = nodes.new("CompositorNodeRLayers")
    out = nodes.new("NodeGroupOutput")

    def math(op, a, b):
        node = nodes.new("ShaderNodeMath")
        node.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                node.inputs[i].default_value = v
            else:
                links.new(v, node.inputs[i])
        return node.outputs["Value"]

    depth = layers.outputs["Depth"]
    thin = math("SUBTRACT", 1.0, math("EXPONENT", math("MULTIPLY", depth, -haze["density_per_m"]), 0.0))
    fac = math("MULTIPLY", thin, math("LESS_THAN", depth, HAZE_SKY_M))
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[7].default_value = linear_rgb(haze["colour"]) + [1.0]
    links.new(fac, mix.inputs[0])
    links.new(layers.outputs["Image"], mix.inputs[6])
    links.new(mix.outputs[2], out.inputs[0])
    scene.compositing_node_group = group


def fill_light(strength):
    for name, travel in (("Fill sun", FILL_TRAVEL), ("Fill sun back", (-FILL_TRAVEL[0], -FILL_TRAVEL[1], FILL_TRAVEL[2]))):
        lamp = bpy.data.lights.new(name, "SUN")
        lamp.energy = strength / 2.0
        lamp.color = FILL_COLOUR
        lamp.use_shadow = False
        obj = bpy.data.objects.new(name, lamp)
        bpy.context.scene.collection.objects.link(obj)
        obj.rotation_euler = Vector(travel).to_track_quat("-Z", "Y").to_euler()


def world(manifest, rotation_deg, sky=None, warm=None):
    w = node_owner(bpy.data.worlds.new("Captured sky"))
    bpy.context.scene.world = w
    nodes, links = w.node_tree.nodes, w.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(manifest["files"]["hdri"], check_existing=True)
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(rotation_deg))
    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    light = nodes["Background"]
    links.new(env.outputs["Color"], light.inputs["Color"])
    if warm:
        _warm(nodes, links, env, light, warm)
    if sky:
        _camera_sky(nodes, links, coord, light, sky)
    w.use_sun_shadow = True
    w.sun_threshold = 5.0
    w.sun_angle = math.radians(1.0)


def _camera_sky(nodes, links, coord, light, sky):
    seen = nodes.new("ShaderNodeBackground")
    split = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = linear_rgb(sky["horizon"]) + [1.0]
    ramp.color_ramp.elements[1].color = linear_rgb(sky["zenith"]) + [1.0]
    ramp.color_ramp.elements[1].position = sky.get("zenith_at", SKY_ZENITH_Z)
    links.new(coord.outputs["Generated"], split.inputs["Vector"])
    links.new(split.outputs["Z"], ramp.inputs["Fac"])
    colour = ramp.outputs["Color"]
    if "clouds" in sky:
        colour = _clouds(nodes, links, coord, colour, sky["clouds"])
    links.new(colour, seen.inputs["Color"])
    seen.inputs["Strength"].default_value = sky["strength"]
    path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    links.new(light.outputs["Background"], mix.inputs[1])
    links.new(seen.outputs["Background"], mix.inputs[2])
    links.new(mix.outputs["Shader"], nodes["World Output"].inputs["Surface"])


def _clouds(nodes, links, coord, colour, clouds):
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = clouds["scale"]
    noise.inputs["Detail"].default_value = CLOUD_DETAIL
    noise.inputs["Roughness"].default_value = CLOUD_ROUGH
    links.new(coord.outputs["Generated"], noise.inputs["Vector"])
    edge = nodes.new("ShaderNodeMapRange")
    low = CLOUD_EDGE - clouds["cover"] * CLOUD_SPAN
    edge.inputs["From Min"].default_value = low
    edge.inputs["From Max"].default_value = low + CLOUD_SOFT
    links.new(noise.outputs["Fac"], edge.inputs["Value"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    links.new(edge.outputs["Result"], mix.inputs[0])
    links.new(colour, mix.inputs[6])
    mix.inputs[7].default_value = linear_rgb(clouds["colour"]) + [1.0]
    return mix.outputs[2]


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


def _log_pile(size, rng):
    w, d, h = size
    bark, ends = bmesh.new(), bmesh.new()
    rows = max(2, int(h // (LOG_RADIUS_IN * 1.75)))
    for r in range(rows):
        shift = LOG_RADIUS_IN if r % 2 else 0.0
        cols = int((w - shift) // (LOG_RADIUS_IN * 2))
        for c in range(cols):
            if r > rows - 3 and rng.random() < 0.25 * (r - rows + 3):
                continue
            rad = LOG_RADIUS_IN * rng.uniform(0.7, 1.05)
            length = d * rng.uniform(0.72, 1.0)
            y0 = rng.uniform(0.0, d - length)
            x = shift + (c + 0.5) * 2 * LOG_RADIUS_IN + rng.uniform(-0.4, 0.4)
            z = rad + r * 1.75 * LOG_RADIUS_IN
            lean = Matrix.Rotation(rng.uniform(-0.05, 0.05), 4, "Z")
            m = Matrix.Translation((in_to_m(x), in_to_m(y0 + length / 2), in_to_m(z))) @ lean @ Matrix.Rotation(math.pi / 2, 4, "X")
            bmesh.ops.create_cone(bark, cap_ends=False, segments=LOG_SIDES, radius1=in_to_m(rad), radius2=in_to_m(rad), depth=in_to_m(length), matrix=m)
            for end in (-1, 1):
                bmesh.ops.create_circle(ends, cap_ends=True, segments=LOG_SIDES, radius=in_to_m(rad * 0.97),
                                        matrix=m @ Matrix.Translation((0.0, 0.0, in_to_m(end * length / 2.0))))
    return {"main": bark, "Log ends": ends}


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


def _picket_fence(size, rng):
    bm = bmesh.new()
    for _, lo, hi in fence.picket_boxes(size, rng):
        _box(bm, lo, hi)
    return bm


SCRIPTED = {"scripted:wood_pile": _wood_pile, "scripted:wood_fence": _wood_fence, "scripted:wood_picket_fence": _picket_fence}


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
        mw = ev.matrix_world
        if o.get(PHOTO_TAG):
            for corner in ev.bound_box:
                p = mw @ Vector(corner)
                for i in range(3):
                    lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
            continue
        mesh = ev.to_mesh()
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


def _scripted_material(entry, materials, manifests):
    if "tint" not in entry:
        return materials[entry["material"]]
    name = entry["material"].split(":", 1)[1] + " tinted"
    return bpy.data.materials.get(name) or pbr_material(name, manifests[entry["material"]], entry["tint"])


def hazards(spec, catalog, materials, manifests):
    for h in spec["hazards"]:
        rng = random.Random(h["id"])
        entry = catalog[h["asset"]]
        if entry["kind"] == "scripted":
            obj = _mesh_object(h["id"], SCRIPTED[h["asset"]](h["size_in"], rng))
            obj.data.materials.append(_scripted_material(entry, materials, manifests))
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
    scene.render.engine = engine.eevee_id(bpy.app.version)
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
    output.video(scene.render)
    ff = scene.render.ffmpeg
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


SIDING_TILE_M = 2.2
SIDING_GRAIN = 0.15
ROOF_GRAIN = 0.85
ROOF_THICK_IN = downspout.ROOF_THICK_IN
GUTTER_TALL_IN = downspout.GUTTER_TALL_IN
GUTTER_WALL_IN = 0.3
GUTTER_SPILL_IN = 2.0
GUTTER_PAINT = ("#f3f1ea", 0.28, 0.3)
GUTTER_LEAF_COLOURS = ("main", "Leaf tan", "Leaf rust", "Leaf grey brown")
GUTTER_LEAF_SHARES = (0.3, 0.3, 0.2, 0.2)
HEAP_FILL = 0.4
HEAP_CREST = 0.8
ROOF_SLOPE = 0.3
ROOF_LITTER = 0.04
LEAF_RIBS = (0.0, 0.38, 0.72, 1.0)
LEAF_WIDTHS = (0.34, 0.3)
LEAF_RIBS_FINE = (0.0, 0.25, 0.5, 0.75, 1.0)
LEAF_WIDTHS_FINE = (0.28, 0.4, 0.26)
SPARE_LEAF_SHARE = 0.4
TUFT_NEEDLES = 5
NEEDLE_WIDTH_IN = 0.45
MULCH_SLOPE = 1.6
MULCH_LEAVES = 70
MULCH_LEAF_IN = 2.0
STEP_RISE_IN = 6
HOUSE_EXPOSURE = 0.9
SKY_ZENITH_Z = 0.6
CLOUD_DETAIL = 6.0
CLOUD_ROUGH = 0.55
CLOUD_EDGE = 0.7
CLOUD_SPAN = 0.4
CLOUD_SOFT = 0.15
FRAME_IN = 3.0
FRAME_PROUD_IN = 1.5
GLASS_OUT_IN = 0.25
GLASS_SET_BACK_IN = 2.0
ROOM_DEPTH_IN = 24
GLASS = ("#eef3f4", 0.02, 1.5)
GARAGE_ROWS = 4
GARAGE_PANEL_IN = 48
PANEL_INSET_IN = 3.0
PANEL_PROUD_IN = 1.0
STRUCTURE_LOOK = {
    "concrete": ("#b9b4aa", 0.85, 0.0),
    "asphalt": ("#3d3d3c", 0.9, 0.0),
    "metal": ("#6a6d70", 0.45, 0.6),
    "gravel": ("#8f8b85", 1.0, 0.0),
    "masonry": ("#9a7f6b", 0.9, 0.0),
    "wood": ("#7b5b3e", 0.85, 0.0),
}
ACCENTS = {
    "Dry leaves": ("#6e4a2a", 0.8, 0.0),
    "Dry leaves tan": ("#a97f48", 0.8, 0.0),
    "Leaf tan": ("#7a5a30", 0.8, 0.0),
    "Leaf rust": ("#5e2c14", 0.8, 0.0),
    "Leaf grey brown": ("#463a2e", 0.85, 0.0),
    "Pine needles": ("#6e431c", 0.75, 0.0),
    "Live leaves": ("#4f5530", 0.7, 0.0),
    "Cushion fabric": ("#8c7a64", 0.9, 0.0),
    "Valve cover": ("#9a9c9e", 0.4, 0.8),
    "Bin wheel": ("#161616", 0.7, 0.0),
    "Shed roof": ("#4d4b47", 0.5, 0.6),
    "Shed door": ("#5e4632", 0.8, 0.0),
    "Vent grille": ("#2a2a2a", 0.5, 0.8),
    "Flue": ("#6f7173", 0.4, 0.8),
    "Window room": ("#cfc6b8", 0.9, 0.0),
    "Dry tufts": ("#bf9a5e", 0.9, 0.0),
    "Conifer needles": ("#2d4a33", 0.8, 0.0),
    "Oak leaves": ("#3f5232", 0.75, 0.0),
    "Log ends": ("#b99a6a", 0.8, 0.0),
}


def linear_rgb(hex_colour):
    out = []
    for i in (1, 3, 5):
        c = int(hex_colour[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def plain_material(name, hex_colour, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = node_owner(bpy.data.materials.new(name))
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = linear_rgb(hex_colour) + [1.0]
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def glass_material():
    mat = bpy.data.materials.get("Window glass")
    if mat is None:
        mat = node_owner(bpy.data.materials.new("Window glass"))
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        colour, rough, ior = GLASS
        bsdf.inputs["Base Color"].default_value = linear_rgb(colour) + [1.0]
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["IOR"].default_value = ior
        bsdf.inputs["Transmission Weight"].default_value = 1.0
    return mat


def _mean_grey(image):
    import numpy
    px = numpy.empty(len(image.pixels), dtype=numpy.float32)
    image.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]
    lin = numpy.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return max(1e-3, float((lin @ numpy.array([0.2126, 0.7152, 0.0722], dtype=numpy.float32)).mean()))


def painted_material(name, manifest, hex_colour, tint, grain, size_m=None, turn_deg=0.0, normal=1.0, translucent=0.0, rough_floor=0.0, specular=None, band_m=0.0):
    mat = node_owner(bpy.data.materials.new(name))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    w, h = (size_m, size_m) if size_m else manifest.get("size_m", [2.0, 2.0])
    mapping.inputs["Scale"].default_value = (1.0 / w, 1.0 / h, 1.0 / w)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(turn_deg))
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def image(key, colour):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(manifest["files"][key], check_existing=True)
        tex.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        tex.projection = "BOX"
        tex.projection_blend = 0.2
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        return tex

    diffuse = image("Diffuse", True)
    bw = nodes.new("ShaderNodeRGBToBW")
    links.new(diffuse.outputs["Color"], bw.inputs["Color"])
    gain = nodes.new("ShaderNodeMath")
    gain.operation = "MULTIPLY_ADD"
    gain.inputs[1].default_value = grain / _mean_grey(diffuse.image)
    gain.inputs[2].default_value = 1.0 - grain
    links.new(bw.outputs["Val"], gain.inputs[0])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    paint = linear_rgb(hex_colour)
    mix.inputs[7].default_value = (paint[0] * tint[0], paint[1] * tint[1], paint[2] * tint[2], 1.0)
    links.new(gain.outputs["Value"], mix.inputs[6])
    shaded = mix.outputs[2]
    if band_m > 0:
        height = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coord.outputs["Object"], height.inputs[0])
        board = nodes.new("ShaderNodeMath")
        board.operation = "DIVIDE"
        board.inputs[1].default_value = band_m
        links.new(height.outputs["Z"], board.inputs[0])
        along = nodes.new("ShaderNodeMath")
        along.operation = "FRACT"
        links.new(board.outputs["Value"], along.inputs[0])
        shadow = nodes.new("ShaderNodeMapRange")
        shadow.inputs["From Min"].default_value = BAND_START
        shadow.inputs["From Max"].default_value = 1.0
        shadow.inputs["To Min"].default_value = 1.0
        shadow.inputs["To Max"].default_value = BAND_SHADE
        links.new(along.outputs["Value"], shadow.inputs["Value"])
        under = nodes.new("ShaderNodeMix")
        under.data_type = "RGBA"
        under.blend_type = "MULTIPLY"
        under.inputs[0].default_value = 1.0
        links.new(mix.outputs[2], under.inputs[6])
        links.new(shadow.outputs["Result"], under.inputs[7])
        shaded = under.outputs[2]
    links.new(shaded, bsdf.inputs["Base Color"])
    rough = image("Rough", False).outputs["Color"]
    if rough_floor > 0:
        floor = nodes.new("ShaderNodeMath")
        floor.operation = "MAXIMUM"
        floor.inputs[1].default_value = rough_floor
        links.new(rough, floor.inputs[0])
        rough = floor.outputs["Value"]
    links.new(rough, bsdf.inputs["Roughness"])
    if specular is not None:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    bump = nodes.new("ShaderNodeNormalMap")
    bump.inputs["Strength"].default_value = normal
    links.new(image("nor_gl", False).outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if translucent > 0:
        through = nodes.new("ShaderNodeBsdfTranslucent")
        links.new(mix.outputs[2], through.inputs["Color"])
        both = nodes.new("ShaderNodeMixShader")
        both.inputs[0].default_value = translucent
        links.new(bsdf.outputs[0], both.inputs[1])
        links.new(through.outputs[0], both.inputs[2])
        links.new(both.outputs[0], nodes.get("Material Output").inputs["Surface"])
    return mat


def _v(p):
    return Vector([in_to_m(c) for c in p])


def _rod(bm, a, b, r0, r1, segments=6):
    a, b = Vector(a), Vector(b)
    axis = b - a
    if axis.length < 1e-6:
        return
    turn = axis.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation(_v((a + b) / 2)) @ turn
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=in_to_m(r0), radius2=in_to_m(r1), depth=in_to_m(axis.length), matrix=m)


def _blob(bm, centre, radii, rng, rough=0.25, subdivisions=1):
    c = _v(centre)
    m = Matrix.Translation(c) @ Matrix.Diagonal([in_to_m(r) for r in radii] + [1.0])
    for v in bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0, matrix=m)["verts"]:
        v.co = c + (v.co - c) * rng.uniform(1.0 - rough, 1.0)


def _within(p, r, size):
    return [min(max(p[i], r[i]), size[i] - r[i]) for i in range(3)]


def _aim(forward, rng, roll=0.5):
    spin = Matrix.Rotation(rng.uniform(-roll, roll), 3, "X")
    return Vector(forward).normalized().to_track_quat("X", "Z").to_matrix() @ spin


def _leaf(bm, centre, length, rng, turn, fine=False):
    """One dry broadleaf: a pointed, lobed outline folded along the midrib, cupped and curled at the tip."""
    ribs, widths = (LEAF_RIBS_FINE, LEAF_WIDTHS_FINE) if fine else (LEAF_RIBS, LEAF_WIDTHS)
    cup, curl = rng.uniform(0.15, 0.45), rng.uniform(-0.3, 0.3) * length
    spread = [w * rng.uniform(0.85, 1.15) * length for w in widths]
    mid, right, left = [], [], []
    for k, s in enumerate(ribs):
        x = (s - 0.5) * length
        z = curl * s * s
        mid.append(bm.verts.new(_v(Vector(centre) + turn @ Vector((x, 0.0, z)))))
        if 0 < k < len(ribs) - 1:
            for side, row in ((1, right), (-1, left)):
                y = side * spread[k - 1]
                row.append(bm.verts.new(_v(Vector(centre) + turn @ Vector((x, y, z + cup * spread[k - 1])))))
    bm.faces.new(list(reversed([mid[0]] + right + [mid[-1]] + mid[-2:0:-1])))
    bm.faces.new(list(reversed([mid[0]] + mid[1:-1] + [mid[-1]] + left[::-1])))


def _needle(bm, base, forward, length, width, rng, segments=1, droop=0.0):
    """A thin pine needle: a strip that narrows to a point, bent down a little per segment when droop is set."""
    d = Vector(forward).normalized()
    side = d.cross(Vector((0.0, 0.0, 1.0)))
    side = side.normalized() if side.length > 1e-3 else Vector((1.0, 0.0, 0.0))
    p, rows = Vector(base), []
    for i in range(segments):
        half = width * 0.5 * (1.0 - i / float(segments))
        rows.append((bm.verts.new(_v(p - side * half)), bm.verts.new(_v(p + side * half))))
        p = p + d * (length / segments)
        d = (Matrix.Rotation(-droop, 3, side) @ d).normalized()
    tip = bm.verts.new(_v(p))
    for (a, b), (c, e) in zip(rows, rows[1:]):
        bm.faces.new((a, b, e, c))
    bm.faces.new((rows[-1][0], rows[-1][1], tip))


def _tuft(bm, p, leaf, rng):
    axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.6))).normalized()
    for _ in range(TUFT_NEEDLES):
        way = axis + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4)))
        _needle(bm, p, way, leaf * rng.uniform(2.2, 3.4), NEEDLE_WIDTH_IN, rng)


def _leaves(bm, centre, radii, rng, count, leaf, size=None, shape="broadleaf", spare=None):
    for _ in range(count):
        p = Vector([centre[i] + rng.gauss(0, 0.45) * radii[i] for i in range(3)])
        if size is not None:
            p = Vector(_within(p, (leaf * 1.3,) * 3, size))
        if shape == "needle":
            _tuft(bm, p, leaf, rng)
            continue
        target = spare if spare is not None and rng.random() < SPARE_LEAF_SHARE else bm
        turn = Euler((rng.uniform(0, math.pi), rng.uniform(0, math.pi), rng.uniform(0, 2 * math.pi))).to_matrix()
        first = len(target.verts)
        _leaf(target, p, 2.0 * leaf * rng.uniform(0.8, 1.2), rng, turn)
        if size is not None:
            _keep_inside(target, first, size)


def _foliage(rng):
    """A stream for drawing leaves that takes nothing from the structure's own stream, so bark and limbs never move when the leaves change."""
    return random.Random(repr(rng.getstate()[1]))


def _replay_cards(rng, count):
    """Spend the draws the old flat card leaves took from the structure's stream, so what is drawn after them keeps its place."""
    for _ in range(count):
        for _ in range(3):
            rng.gauss(0, 0.45)
        for _ in range(3):
            rng.uniform(0, 1)


def _frustum(bm, lo0, hi0, lo1, hi1, z0, z1):
    rings = []
    for (a, b), z in (((lo0, hi0), z0), ((lo1, hi1), z1)):
        rings.append([bm.verts.new(_v((x, y, z))) for x, y in ((a[0], a[1]), (b[0], a[1]), (b[0], b[1]), (a[0], b[1]))])
    lo, hi = rings
    for i in range(4):
        bm.faces.new((lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]))
    bm.faces.new(hi)
    bm.faces.new(list(reversed(lo)))


def _gable_slab(bm, span_axis, s0, s1, r0, r1, eave_z, ridge_z, thick):
    mid = (s0 + s1) / 2.0
    section = [(s0, eave_z), (mid, ridge_z), (s1, eave_z), (s1, eave_z - thick), (mid, ridge_z - thick), (s0, eave_z - thick)]
    ends = []
    for r in (r0, r1):
        ring = []
        for s, z in section:
            p = [0.0, 0.0, z]
            p[span_axis], p[1 - span_axis] = s, r
            ring.append(bm.verts.new(_v(p)))
        ends.append(ring)
    a, b = ends
    faces = [bm.faces.new((a[i], a[(i + 1) % 6], b[(i + 1) % 6], b[i])) for i in range(6)]
    faces += [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def _gable_end(bm, span_axis, s0, s1, line, base_z, apex_z, outward):
    pts = []
    for s, z in ((s0, base_z), ((s0 + s1) / 2.0, apex_z), (s1, base_z)):
        q = [0.0, 0.0, z]
        q[span_axis], q[1 - span_axis] = s, line
        pts.append(bm.verts.new(_v(q)))
    face = bm.faces.new(pts)
    face.normal_update()
    if face.normal[1 - span_axis] * outward < 0:
        face.normal_flip()


def _keep_inside(bm, first, size):
    """Slide the vertices made since index first back into the box, so a long needle or tilted leaf never pushes the mesh past it."""
    bm.verts.ensure_lookup_table()
    made = bm.verts[first:]
    shift = Vector((0.0, 0.0, 0.0))
    for i in range(3):
        lo, hi, top = min(v.co[i] for v in made), max(v.co[i] for v in made), in_to_m(size[i])
        shift[i] = -lo if lo < 0.0 else (top - hi if hi > top else 0.0)
    for v in made:
        v.co += shift


def _stretch(parts, size):
    verts = [v for bm in parts for v in bm.verts]
    lo = [min(v.co[i] for v in verts) for i in range(3)]
    hi = [max(v.co[i] for v in verts) for i in range(3)]
    for v in verts:
        v.co = Vector([(v.co[i] - lo[i]) / (hi[i] - lo[i]) * in_to_m(size[i]) for i in range(3)])


def _heap_top(x, y, w, back, lip, phase):
    t = min(max((y - back) / (lip - back), 0.0), 1.0)
    across = 1.0 - ((t - HEAP_CREST) / (HEAP_CREST if t < HEAP_CREST else 1.0 - HEAP_CREST + 0.1)) ** 2
    along = 0.25 * (1.0 + math.sin(2 * math.pi * x / 70.0 + phase[0])) + 0.25 * (1.0 + math.sin(2 * math.pi * x / 23.0 + phase[1]))
    return GUTTER_TALL_IN + 1.0 + across * (1.0 + 3.8 * along)


def _gutter_leaves(size, rng):
    """Dry leaves and pine needles heaped in the gutter and over its lip, and strewn on the roof edge behind it.

    The spec box starts at the wall; the gutter is one eave wide, starts one eave out and ends GUTTER_SPILL_IN
    inside the box's far face. A needle at each extreme keeps the mesh the size of the box."""
    w, d, h = size
    front = d - GUTTER_SPILL_IN
    width = front / 2.0
    back, lip = width + GUTTER_WALL_IN, front - GUTTER_WALL_IN
    phase = (rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi))
    parts = {key: bmesh.new() for key in GUTTER_LEAF_COLOURS + ("Pine needles",)}
    pine = parts["Pine needles"]

    def pick():
        r = rng.random()
        for key, share in zip(GUTTER_LEAF_COLOURS, GUTTER_LEAF_SHARES):
            r -= share
            if r < 0.0:
                return key
        return "main"

    def lying(pitch):
        yaw, tilt = rng.uniform(0, 2 * math.pi), rng.uniform(-pitch, pitch)
        return (math.cos(yaw) * math.cos(tilt), math.sin(yaw) * math.cos(tilt), math.sin(tilt))

    def leaf(p, forward, length=None):
        target = parts[pick()]
        first = len(target.verts)
        _leaf(target, Vector(p), length or rng.uniform(2.6, 4.2), rng, _aim(forward, rng, 0.7), fine=True)
        _keep_inside(target, first, size)

    def needles(p, forward, count, length=(3.5, 6.0)):
        for _ in range(count):
            first = len(pine.verts)
            way = Vector(forward) + Vector((rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), rng.uniform(-0.1, 0.1)))
            _needle(pine, Vector(p) + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0.0)), way,
                    rng.uniform(*length), rng.uniform(0.16, 0.26), rng, 3, 0.12)
            _keep_inside(pine, first, size)

    def anchor(p, forward, until, axis):
        f = Vector(forward).normalized()
        _needle(pine, p, f, (until - p[axis]) / f[axis], 0.2, rng, 3)

    def roof(y):
        return GUTTER_TALL_IN + (width - y) * ROOF_SLOPE + 0.45

    for k in range(int(w * (lip - back) * HEAP_FILL)):
        x, y = rng.uniform(1.0, w - 1.0), rng.uniform(back + 0.6, lip - 0.6)
        top = _heap_top(x, y, w, back, lip, phase)
        z = top - rng.uniform(0.0, 0.7) if k % 4 else rng.uniform(0.5, top - 0.7)
        leaf((x, y, z), lying(0.7))
        if k % 3 == 0:
            needles((x, y, z), lying(0.45), 2)
    x = rng.uniform(0.0, 2.0)
    while x < w:
        leaf((x, front + rng.uniform(0.1, 0.35), GUTTER_TALL_IN + rng.uniform(-0.3, 0.9)), (rng.uniform(-0.3, 0.3), rng.uniform(0.1, 0.5), -1.0))
        if rng.random() < 0.5:
            needles((x, front - 0.2, GUTTER_TALL_IN + 0.5), (rng.uniform(-0.3, 0.3), 1.0, -rng.uniform(0.6, 1.6)), 2, (3.0, 5.0))
        x += rng.uniform(1.5, 3.5)
    x = rng.uniform(0.0, 2.0)
    while x < w:
        y = rng.uniform(lip - 1.4, lip + 0.2)
        leaf((x, y, _heap_top(x, y, w, back, lip, phase) - 0.6), (rng.uniform(-0.5, 0.5), rng.uniform(0.3, 1.0), rng.uniform(0.4, 1.3)))
        x += rng.uniform(1.5, 4.0)
    for _ in range(int(w / 5.0)):
        x, y = rng.uniform(1.0, w - 1.0), rng.uniform(lip - 2.5, lip - 0.3)
        needles((x, y, _heap_top(x, y, w, back, lip, phase) - 0.3), (rng.uniform(-0.4, 0.4), rng.uniform(0.1, 0.8), rng.uniform(0.9, 2.0)), 3)
    for _ in range(int(w / 20.0)):
        x, y = rng.uniform(1.0, w - 1.0), rng.uniform(back + 0.8, lip - 0.8)
        leaf((x, y, _heap_top(x, y, w, back, lip, phase) - 0.2), (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1.0), 3.0)
    for _ in range(int(w * width * ROOF_LITTER)):
        x, y = rng.uniform(1.0, w - 1.0), rng.uniform(1.5, width - 0.6)
        leaf((x, y, roof(y)), lying(0.25))
        needles((x, y, roof(y) - 0.15), lying(0.25), 2)
    mid = (back + lip) / 2.0
    anchor((0.31 * w, mid, GUTTER_TALL_IN + 3.0), (0.1, 0.05, 1.0), h, 2)
    anchor((0.62 * w, lip, GUTTER_TALL_IN + 0.4), (0.0, 1.0, -0.35), d, 1)
    anchor((0.45 * w, 0.0, roof(0.0)), (0.0, 1.0, -ROOF_SLOPE), 4.0, 1)
    for x, way in ((0.0, 1.0), (w, -1.0)):
        _needle(pine, (x, mid, 0.0), (way, 0.0, 0.0), 4.0, 0.2, rng, 3)
    _stretch(list(parts.values()), size)
    return parts


def _vent_leaf_mulch(size, rng):
    w, d, h = size
    bm, leaves = bmesh.new(), bmesh.new()

    def surface(u, t):
        return h * math.sin(math.pi * u) ** 0.6 * (1 - t) ** MULCH_SLOPE

    nx, ny = 12, 6
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, t = i / float(nx), j / float(ny)
            jitter = rng.uniform(0.82, 1.0) if 0 < i < nx and j < ny else 1.0
            row.append(bm.verts.new(_v((w * u, d * t, surface(u, t) * jitter))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    for _ in range(8):
        u, t = rng.uniform(0.2, 0.8), rng.uniform(0.0, 0.5)
        r = (rng.uniform(2.0, 3.5), rng.uniform(2.0, 3.5), rng.uniform(1.0, 2.0))
        _blob(bm, _within((w * u, d * t, surface(u, t) * 0.6), r, size), r, rng)
    for _ in range(MULCH_LEAVES):
        u, t = rng.uniform(0.04, 0.96), rng.uniform(0.0, 0.85)
        _flake(leaves, _within((w * u, d * t, surface(u, t) + 0.5), (MULCH_LEAF_IN,) * 3, size), MULCH_LEAF_IN, rng)
    return {"main": bm, "Dry leaves": leaves}


def _flake(bm, p, leaf, rng):
    turn = Euler((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0, 2 * math.pi))).to_matrix()
    corners = [turn @ Vector((sx * leaf, sy * leaf * 0.55, 0.0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new([bm.verts.new(_v(Vector(p) + c)) for c in corners])


def _overhanging_branch(size, rng):
    w, d, h = size
    bark, leaves, tan = bmesh.new(), bmesh.new(), bmesh.new()
    foliage = _foliage(rng)
    pts = [Vector((w * 0.5, d, h * 0.55))]
    for k in range(1, 5):
        t = k / 4.0
        pts.append(Vector((w * (0.5 + rng.uniform(-0.12, 0.12)), d * (1 - t), h * (0.55 - 0.25 * t + rng.uniform(-0.05, 0.05)))))
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        _rod(bark, a, b, 3.5 - 0.55 * k, 3.5 - 0.55 * (k + 1), 8)
    for _ in range(BRANCH_TWIGS):
        k = rng.randrange(1, len(pts))
        base = pts[k - 1].lerp(pts[k], rng.random())
        way = Vector((rng.choice((-1, 1)) * rng.uniform(0.4, 1.0), rng.uniform(-0.5, 0.3), rng.uniform(-0.1, 0.4))).normalized()
        r = (rng.uniform(6, 10), rng.uniform(6, 10), rng.uniform(3, 5))
        tip = Vector(_within(base + way * rng.uniform(14, 30), r, size))
        _rod(bark, base, tip, 0.9, 0.25, 5)
        _leaves(leaves, tip, r, foliage, BRANCH_TIP_LEAVES, 1.8, size, spare=tan)
        _replay_cards(rng, BRANCH_TIP_LEAVES)
    for p in pts[1:]:
        _leaves(leaves, p + Vector((0, 0, 3)), (8, 8, 4), foliage, BRANCH_TIP_LEAVES, 1.8, size, spare=tan)
    return {"main": bark, "Dry leaves": leaves, "Dry leaves tan": tan}


def _dead_shrub(size, rng):
    w, d, h = size
    stems, leaves = bmesh.new(), bmesh.new()
    for _ in range(28):
        base = Vector((w * (0.5 + rng.uniform(-0.12, 0.12)), d * (0.5 + rng.uniform(-0.12, 0.12)), 0.0))
        ang, spread = rng.uniform(0, 2 * math.pi), rng.uniform(0.3, 1.0)
        top = Vector((w * 0.5 + math.cos(ang) * spread * w * 0.48, d * 0.5 + math.sin(ang) * spread * d * 0.48, h * rng.uniform(0.55, 1.0)))
        mid = base.lerp(top, 0.5) + Vector((rng.uniform(-2, 2), rng.uniform(-2, 2), 0))
        _rod(stems, base, mid, 0.7, 0.45, 5)
        _rod(stems, mid, top, 0.45, 0.15, 5)
        twig = Vector(_within(mid + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1))).normalized() * rng.uniform(8, 14), (0, 0, 0), size))
        _rod(stems, mid, twig, 0.3, 0.1, 4)
        if rng.random() < 0.6:
            r = (rng.uniform(2, 3.5), rng.uniform(2, 3.5), rng.uniform(1.2, 2.0))
            _blob(leaves, _within(top, r, size), r, rng)
    return {"main": stems, "Dry leaves": leaves}


def _propane_tank(size, rng):
    w, d, h = size
    body, valve = bmesh.new(), bmesh.new()
    legs = h * 0.17
    r = min(d * 0.5, (h - legs - h * 0.08) / 2.0)
    cz = legs + r
    turn = Matrix.Rotation(math.pi / 2, 4, "Y")
    bmesh.ops.create_cone(body, cap_ends=True, segments=24, radius1=in_to_m(r), radius2=in_to_m(r), depth=in_to_m(w - 2 * r),
                          matrix=Matrix.Translation(_v((w / 2.0, d / 2.0, cz))) @ turn)
    for x in (r, w - r):
        bmesh.ops.create_uvsphere(body, u_segments=24, v_segments=12, radius=in_to_m(r), matrix=Matrix.Translation(_v((x, d / 2.0, cz))))
    for x in (w * 0.27, w * 0.73):
        _box(body, (x - 2, 0, 0), (x + 2, d, legs + r * 0.4))
    _rod(valve, (w / 2.0, d / 2.0, cz + r * 0.8), (w / 2.0, d / 2.0, h), 4.5, 4.0, 16)
    return {"main": body, "Valve cover": valve}


def _storage_shed(size, rng):
    w, d, h = size
    planks, roof, door = bmesh.new(), bmesh.new(), bmesh.new()
    over, thick = 4.0, 3.0
    wall = h * 0.7
    eave_z = wall - over * (h - wall) / (w / 2.0 - over)
    _box(planks, (over, over, 0), (w - over, d - over, wall))
    for line, outward in ((over, -1), (d - over, 1)):
        _gable_end(planks, 0, over, w - over, line, wall, h - 1, outward)
    _gable_slab(roof, 0, 0, w, 0, d, eave_z, h, thick)
    _box(door, (w / 2.0 - 16, over - 1, 0), (w / 2.0 + 16, over, min(70.0, wall - 4)))
    return {"main": planks, "Shed roof": roof, "Shed door": door}


def _trash_cans(size, rng):
    w, d, h = size
    body, wheels = bmesh.new(), bmesh.new()
    gap = 3.0
    bw = (w - gap) / 2.0
    for x0 in (0.0, bw + gap):
        _frustum(body, (x0 + 1.5, 2.5), (x0 + bw - 1.5, d - 1.5), (x0 + 0.5, 1.5), (x0 + bw - 0.5, d - 0.5), 1.5, h - 2.5)
        _box(body, (x0, 0.5, h - 2.5), (x0 + bw, d, h))
        _box(body, (x0 + 3, 0, h - 6), (x0 + bw - 3, 1.5, h - 4))
        for a in (x0 + 1, x0 + bw - 4):
            _rod(wheels, (a, 3.5, 3.5), (a + 3, 3.5, 3.5), 3.5, 3.5, 12)
    return {"main": body, "Bin wheel": wheels}


def _patio_set(size, rng):
    w, d, h = size
    wood, cushion = bmesh.new(), bmesh.new()
    cw = min(26.0, w * 0.36)
    seat = h * 0.45
    for x0 in (0.0, w - cw):
        x1 = x0 + cw
        for x in (x0, x1 - 2):
            for y in (0, d - 2):
                _box(wood, (x, y, 0), (x + 2, y + 2, seat))
            _box(wood, (x, 0, seat), (x + 2, 2, h))
            _box(wood, (x, 2, seat + 8), (x + 2, d, seat + 10))
            _box(wood, (x, d - 2, seat), (x + 2, d, seat + 8))
        _box(wood, (x0, 0, seat - 2), (x1, d, seat))
        _box(wood, (x0 + 2, 0, h - 3), (x1 - 2, 2, h))
        _box(cushion, (x0 + 2.5, 3, seat), (x1 - 2.5, d - 1.5, seat + 3.5))
        _box(cushion, (x0 + 2.5, 2, seat + 3.5), (x1 - 2.5, 5.5, h - 4))
    tx0, tx1 = cw + 3, w - cw - 3
    _box(wood, (tx0, d * 0.2, seat + 3), (tx1, d * 0.8, seat + 4.5))
    for x in (tx0 + 1, tx1 - 3):
        _box(wood, (x, d * 0.45, 0), (x + 2, d * 0.55, seat + 3))
    return {"main": wood, "Cushion fabric": cushion}


def _tall_dry_grass(size, rng):
    w, d, h = size
    bm = bmesh.new()
    nx, ny = max(1, int(w // 7)), max(1, int(d // 7))
    for i in range(nx):
        for j in range(ny):
            cx, cy = (i + rng.uniform(0.1, 0.9)) * w / nx, (j + rng.uniform(0.1, 0.9)) * d / ny
            for _ in range(9):
                tall = h * rng.uniform(0.5, 1.0)
                lean, ang, face = rng.uniform(0, 0.35) * tall, rng.uniform(0, 2 * math.pi), rng.uniform(0, math.pi)
                bx, by = cx + rng.uniform(-1.5, 1.5), cy + rng.uniform(-1.5, 1.5)
                ox, oy = math.cos(face) * 0.5, math.sin(face) * 0.5
                pts = ((bx - ox, by - oy, 0), (bx + ox, by + oy, 0), (bx + math.cos(ang) * lean, by + math.sin(ang) * lean, tall))
                bm.faces.new([bm.verts.new(_v((min(max(x, 0), w), min(max(y, 0), d), z))) for x, y, z in pts])
    return {"main": bm}


def _fit_crown(bm, reach_in, top_in):
    far = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
    high = max(v.co.z for v in bm.verts)
    across, up = in_to_m(reach_in) / far, in_to_m(top_in) / high
    for v in bm.verts:
        v.co = Vector((v.co.x * across, v.co.y * across, v.co.z * up))


def _conifer_limb(bark, leaves, z, ang, length, rng):
    foliage = _foliage(rng)
    d = Vector((math.cos(ang), math.sin(ang), 0.0))
    base, tip = d * 2.0 + Vector((0, 0, z)), d * length + Vector((0, 0, z - length * 0.16))
    mid = base.lerp(tip, 0.5) + Vector((0, 0, length * 0.06))
    _rod(bark, base, mid, 1.2, 0.75, 5)
    _rod(bark, mid, tip, 0.75, 0.25, 5)
    for s in (0.25, 0.45, 0.65, 0.85):
        r = length * rng.uniform(0.22, 0.3)
        _blob(leaves, base.lerp(tip, s) + Vector((0, 0, r * 0.15)), (r, r, r * 0.5), rng, 0.3)
        _leaves(leaves, base.lerp(tip, s), (r * 0.7, r * 0.7, r * 0.3), foliage, 3, 2.4, shape="needle")
    _leaves(leaves, tip, (length * 0.25, length * 0.25, length * 0.08), foliage, 14, 2.4, shape="needle")


def _conifer(bark, leaves, tree, rng):
    h, reach, r0 = float(tree["height_in"]), tree["canopy_in"] / 2.0, tree["trunk_in"] / 2.0
    spine = [Vector((rng.uniform(-1, 1) * r0 * 0.2 * k / 6.0, rng.uniform(-1, 1) * r0 * 0.2 * k / 6.0, h * k / 6.0)) for k in range(7)]
    _rod(bark, (0, 0, 0), (0, 0, 18), r0 * 1.3, r0 * 1.05, 12)
    for k, (a, b) in enumerate(zip(spine, spine[1:])):
        _rod(bark, a, b, max(1.0, r0 * (1.0 - k / 6.0)), max(1.0, r0 * (1.0 - (k + 1) / 6.0)), 12)
    low = h * CROWN_LOW
    tiers = max(5, int((h - low) / TIER_IN))
    for k in range(tiers):
        u = min(max((k + rng.uniform(-0.15, 0.15)) / tiers, 0.0), 0.98)
        spread = reach * (1.0 - u) ** 0.9 * (1.0 if k == 0 else rng.uniform(0.82, 1.0))
        count = max(5, int(round(4 + 6 * spread / reach)))
        turn = rng.uniform(0, 2 * math.pi)
        for j in range(count):
            ang = turn + (j + rng.uniform(-0.2, 0.2)) * 2 * math.pi / count
            _conifer_limb(bark, leaves, low + (h - low) * 0.97 * u, ang, spread * rng.uniform(0.85, 1.0), rng)
    _fit_crown(leaves, reach, h * 0.985)


def _oak(bark, leaves, tree, rng):
    h, reach, r0 = float(tree["height_in"]), tree["canopy_in"] / 2.0, tree["trunk_in"] / 2.0
    fork_z = h * rng.uniform(*OAK_FORK)
    span = h - fork_z
    fork = Vector((rng.uniform(-1, 1) * r0 * 0.4, rng.uniform(-1, 1) * r0 * 0.4, fork_z))
    _rod(bark, (0, 0, 0), (0, 0, 14), r0 * 1.35, r0 * 1.1, 12)
    _rod(bark, (0, 0, 12), fork, r0 * 1.1, r0 * 0.85, 12)
    limbs = rng.choice((4, 5))
    turn = rng.uniform(0, 2 * math.pi)
    for k in range(limbs):
        ang = turn + (k + rng.uniform(-0.2, 0.2)) * 2 * math.pi / limbs
        d = Vector((math.cos(ang), math.sin(ang), 0.0))
        end = d * reach * rng.uniform(0.7, 0.9) + Vector((0, 0, h * rng.uniform(0.42, 0.7)))
        mid = fork.lerp(end, 0.5) + Vector((rng.uniform(-6, 6), rng.uniform(-6, 6), span * 0.05))
        _rod(bark, fork, mid, r0 * 0.7, r0 * 0.5, 8)
        _rod(bark, mid, end, r0 * 0.5, r0 * 0.25, 8)
        for _ in range(2):
            twig = end + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1))).normalized() * rng.uniform(25, 50)
            _rod(bark, end, twig, r0 * 0.2, 0.6, 5)
    centre_z, half = h * 0.62, h * 0.38
    foliage = _foliage(rng)
    for _ in range(40 + int(reach / 4.0)):
        r = reach * rng.uniform(0.2, 0.33)
        while True:
            v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            if 0.01 < v.length <= 1.0 and v.z > -0.55:
                break
        v *= rng.uniform(0.45, 1.0) ** 0.6 / v.length
        centre = Vector((v.x * (reach - r), v.y * (reach - r), centre_z + v.z * max(half - r * 0.75, 0.0)))
        _blob(leaves, centre, (r, r, r * 0.7), rng, 0.2, 2)
        _leaves(leaves, centre, (r, r, r * 0.7), foliage, 14, 3.0)
        _replay_cards(rng, 10)
    _fit_crown(leaves, reach, h)


def _lot_tree(tree, rng, joints=()):
    bark, leaves = bmesh.new(), bmesh.new()
    form = house_spec.tree_form(tree)
    (_conifer if form == "conifer" else _oak)(bark, leaves, tree, rng)
    for joint in joints:
        end = Vector(joint)
        out = Vector((end.x, end.y, 0.0)).normalized()
        start = out * tree["trunk_in"] * 0.4 + Vector((0, 0, max(end.z - 24.0, 36.0)))
        mid = start.lerp(end, 0.5) + Vector((0, 0, 8.0))
        _rod(bark, start, mid, 6.0, 4.5, 8)
        _rod(bark, mid, end, 4.5, 3.5, 8)
    return {"main": bark, "Conifer needles" if form == "conifer" else "Oak leaves": leaves}


TREE_SCRIPTED = {"scripted:lot_tree": _lot_tree}


def _photo_tree(tree, options, manifests):
    rng = random.Random(tree["id"])
    root = _link(bpy.data.objects.new(tree["id"] + " root", None))
    root.location = _v((tree["at_in"][0], tree["at_in"][1], 0))
    variant = photoscan.choose(options, tree["id"])
    for k in range(variant.get("copies", 1)):
        objs, lo, hi = photomodel.instance(manifests[variant["id"]], variant, _link)
        holder = _link(bpy.data.objects.new("%s fit %d" % (tree["id"], k), None))
        holder.parent = root
        shrink = 1.0 - COPY_SHRINK * k
        across = in_to_m(tree["canopy_in"]) / max(hi[0] - lo[0], hi[1] - lo[1]) * shrink
        up = min(max(in_to_m(tree["height_in"]) / (hi[2] - lo[2]), across * TREE_STRETCH[0]), across * TREE_STRETCH[1])
        holder.scale = (across, across, up)
        holder.rotation_euler = (0.0, 0.0, rng.uniform(0.0, 2 * math.pi))
        holder.location = (0.0, 0.0, -up * lo[2])
        for n, o in enumerate(objs):
            o.name = (tree["id"] if k == 0 else "%s copy %d" % (tree["id"], k)) if n == 0 else "%s part %d.%d" % (tree["id"], k, n)
            o.parent = holder
            o[TREE_TAG] = tree["id"]
            o[PHOTO_TAG] = True
    bpy.context.view_layer.update()
    return root


def place_tree(tree, entry, manifests, cache, joints, photo=False):
    options = photoscan.variants(entry, house_spec.tree_form(tree)) if photo else []
    if options and not tree["branches"]:
        return _photo_tree(tree, options, manifests)
    rng = random.Random(tree["id"])
    root = _link(bpy.data.objects.new(tree["id"] + " root", None))
    root.location = _v((tree["at_in"][0], tree["at_in"][1], 0))
    for key, bm in TREE_SCRIPTED[tree["asset"]](tree, rng, joints).items():
        obj = _mesh_object(tree["id"] if key == "main" else "%s %s" % (tree["id"], key.lower()), bm)
        obj.data.materials.append(_hazard_material(tree["asset"], entry, manifests, cache) if key == "main" else plain_material(key, *ACCENTS[key]))
        obj.data.shade_smooth()
        obj.parent = root
        obj[TREE_TAG] = tree["id"]
    bpy.context.view_layer.update()
    return root


def branch_root(h, edge):
    obj = bpy.data.objects[h["id"]]
    (sx, sy), (nx, ny) = edge["start"], edge["n"]
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    out = [(m_to_in(p.x) - sx) * nx + (m_to_in(p.y) - sy) * ny for p in points]
    far = [p for p, o in zip(points, out) if o > h["distance_in"] + h["size_in"][1] - 2.0]
    return [m_to_in(sum(p[i] for p in far) / len(far)) for i in range(3)]


def tree_record(spec):
    out = []
    for t in spec.get("trees", []):
        objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get(TREE_TAG) == t["id"]]
        lo, hi = world_bounds(objs)
        out.append({"id": t["id"], "form": house_spec.tree_form(t), "min_in": [round(m_to_in(c), 2) for c in lo], "max_in": [round(m_to_in(c), 2) for c in hi]})
    return out


HOUSE_SCRIPTED = {
    "scripted:wood_pile": _log_pile,
    "scripted:wood_fence": lambda size, rng: {"main": _wood_fence(size, rng)},
    "scripted:wood_picket_fence": lambda size, rng: {"main": _picket_fence(size, rng)},
    "scripted:gutter_leaves": _gutter_leaves,
    "scripted:vent_leaf_mulch": _vent_leaf_mulch,
    "scripted:overhanging_branch": _overhanging_branch,
    "scripted:dead_shrub": _dead_shrub,
    "scripted:propane_tank": _propane_tank,
    "scripted:storage_shed": _storage_shed,
    "scripted:trash_cans": _trash_cans,
    "scripted:patio_set": _patio_set,
    "scripted:tall_dry_grass": _tall_dry_grass,
}


def _hazard_material(asset_id, entry, manifests, cache):
    if asset_id not in cache:
        name = asset_id.split(":", 1)[1] + " look"
        manifest = manifests[entry["material"]]
        paint = entry.get("paint")
        if paint:
            cache[asset_id] = painted_material(name, manifest, paint["colour"], paint.get("tint", [1.0, 1.0, 1.0]), paint["grain"],
                                               normal=paint.get("normal", 1.0), translucent=paint.get("translucent", 0.0))
        else:
            cache[asset_id] = pbr_material(name, manifest, entry.get("tint"))
    return cache[asset_id]


def _side_point(edge, along, out, z):
    (sx, sy), (ux, uy), (nx, ny) = edge["start"], edge["u"], edge["n"]
    return (sx + ux * along + nx * out, sy + uy * along + ny * out, z)


def _photo_hazard(h, options, manifests):
    variant = photoscan.choose(options, h["id"])
    root = _link(bpy.data.objects.new(h["id"] + " root", None))
    root[HAZARD_TAG] = h["id"]
    w, d, z = h["size_in"]
    copies = variant.get("copies", 1)
    for k in range(copies):
        objs, lo, hi = photomodel.instance(manifests[variant["id"]], variant, _link)
        holder = _link(bpy.data.objects.new(h["id"] + " fit" + (" %d" % k if copies > 1 else ""), None))
        holder.parent = root
        photomodel.fit(holder, lo, hi, ((w * k / copies, 0, 0), (w * (k + 1) / copies, d, z)), variant.get("fit", "stretch"))
        for n, o in enumerate(objs):
            o.name = h["id"] if k == 0 and n == 0 else "%s part %d.%d" % (h["id"], k, n)
            o.parent = holder
            o[HAZARD_TAG] = h["id"]
            o[PHOTO_TAG] = True
    return root


def place_hazard(h, edge, catalog, manifests, cache, photo=False):
    rng = random.Random(h["id"])
    entry = catalog[h["asset"]]
    options = photoscan.variants(entry) if photo and entry["kind"] == "scripted" else []
    if options:
        root = _photo_hazard(h, options, manifests)
        root.rotation_euler = (0.0, 0.0, math.atan2(edge["u"][1], edge["u"][0]))
        root.location = _v(_side_point(edge, h["along_in"], h["distance_in"], h.get("elevation_in", 0)))
        bpy.context.view_layer.update()
        return root
    if entry["kind"] == "scripted":
        objs = []
        for key, bm in HOUSE_SCRIPTED[h["asset"]](h["size_in"], rng).items():
            obj = _mesh_object(h["id"] if key == "main" else "%s %s" % (h["id"], key.lower()), bm)
            obj.data.materials.append(_hazard_material(h["asset"], entry, manifests, cache) if key == "main" else plain_material(key, *ACCENTS[key]))
            objs.append(obj)
        count = 1
    else:
        objs = _append_model(manifests[h["asset"]]["files"]["blend"])
        count = entry.get("cluster", 1)
    root = _link(bpy.data.objects.new(h["id"] + " root", None))
    root[HAZARD_TAG] = h["id"]
    holder = _link(bpy.data.objects.new(h["id"] + " fit", None))
    holder.parent = root
    meshes = []
    for part, members in _cluster(objs, count, rng):
        part.parent = holder
        meshes.extend(members)
    for o in meshes:
        o[HAZARD_TAG] = h["id"]
    _fit(holder, meshes, ((0, 0, 0), tuple(h["size_in"])))
    root.rotation_euler = (0.0, 0.0, math.atan2(edge["u"][1], edge["u"][0]))
    root.location = _v(_side_point(edge, h["along_in"], h["distance_in"], h.get("elevation_in", 0)))
    bpy.context.view_layer.update()
    return root


def _branch_support(h, edge, standoff, bark, rng):
    w, d, z = h["size_in"]
    along = h["along_in"] + w / 2.0
    out = max(h["distance_in"] + d + 12, standoff + 60)
    joint = h["elevation_in"] + z * 0.55
    top = joint + 100
    wood, leaves = bmesh.new(), bmesh.new()
    foliage = _foliage(rng)
    crown = _side_point(edge, along, out + 18, top)
    _rod(wood, _side_point(edge, along, out, 0), _side_point(edge, along, out + 6, joint), 9, 6, 12)
    _rod(wood, _side_point(edge, along, out + 6, joint), crown, 6, 3.5, 12)
    bend = _side_point(edge, along + rng.uniform(-8, 8), (out + h["distance_in"] + d) / 2.0, joint + 10)
    _rod(wood, _side_point(edge, along, out + 6, joint - 6), bend, 4.5, 4, 8)
    _rod(wood, bend, _side_point(edge, along, h["distance_in"] + d, joint), 4, 3.5, 8)
    for _ in range(6):
        start = Vector(_side_point(edge, along, out + 6 + rng.uniform(4, 12), joint + rng.uniform(30, 95)))
        tip = _side_point(edge, along + rng.uniform(-80, 80), out + rng.uniform(10, 90), top + rng.uniform(-10, 40))
        _rod(wood, start, tip, 2.5, 0.8, 6)
        for _ in range(4):
            _leaves(leaves, Vector(tip) + Vector((rng.uniform(-14, 14), rng.uniform(-14, 14), rng.uniform(-8, 8))), (12, 12, 7), foliage, 70, 2.2)
            _replay_cards(rng, 70)
    name = "Branch support " + h["id"]
    _mesh_object(name, wood).data.materials.append(bark)
    _mesh_object(name + " leaves", leaves).data.materials.append(plain_material("Live leaves", *ACCENTS["Live leaves"]))


def _photo_support(h, edge, standoff, bark, rng, options, manifests):
    w, d, z = h["size_in"]
    along = h["along_in"] + w / 2.0
    out = max(h["distance_in"] + d + 12, standoff + 60)
    joint = h["elevation_in"] + z * 0.55
    base = _side_point(edge, along, out, 0)
    _photo_tree({"id": h["id"] + " oak", "at_in": base[:2], "canopy_in": SUPPORT_CANOPY_IN, "height_in": joint + SUPPORT_RISE_IN}, options, manifests)
    wood = bmesh.new()
    bend = _side_point(edge, along + rng.uniform(-8, 8), (out + h["distance_in"] + d) / 2.0, joint + 10)
    _rod(wood, _side_point(edge, along, out + 6, joint - 6), bend, 4.5, 4, 8)
    _rod(wood, bend, _side_point(edge, along, h["distance_in"] + d, joint), 4, 3.5, 8)
    _mesh_object("Branch support " + h["id"], wood).data.materials.append(bark)
    _mesh_object("Branch support %s leaves" % h["id"], bmesh.new())


def _house_walls(spec, eds, prisms, siding):
    wall = prisms[0]["wall_in"]
    bm = bmesh.new()
    low = [bm.verts.new(_v((e["start"][0], e["start"][1], 0))) for e in eds]
    high = [bm.verts.new(_v((e["start"][0], e["start"][1], wall))) for e in eds]
    sides = []
    for i in range(len(eds)):
        j = (i + 1) % len(eds)
        sides.append(bm.faces.new((low[i], low[j], high[j], high[i])))
    bm.faces.new(high)
    bm.faces.new(list(reversed(low)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    holes = openings(spec)
    for e, face in zip(eds, sides):
        if e["side"] in holes:
            bmesh.ops.delete(bm, geom=[face], context="FACES_ONLY")
            for a0, a1, z0, z1 in wall_panels(e["length_in"], wall, holes[e["side"]]):
                _wall_quad(bm, e, a0, a1, 0.0, z0, z1)
    for axis, s0, s1, line, outward, apex in _gables(spec, prisms):
        _gable_end(bm, axis, s0, s1, line, wall, apex, outward)
    body = _mesh_object("House wall", bm)
    body.data.materials.append(siding)
    body["ew_role"] = "wall"


def _gables(spec, prisms):
    """Each gable end as (span axis, span start, span end, line, outward sign, apex height)."""
    eave = spec["house"]["roof"]["eave_in"]
    for b, p in zip(spec["house"]["roof"]["blocks"], prisms):
        axis = 1 if p["ridge"] == "east_west" else 0
        run = 1 - axis
        for line, bound, outward in ((b["min_in"][run], p["lo"][run], -1), (b["max_in"][run], p["hi"][run], 1)):
            if bound == line + outward * eave:
                yield axis, b["min_in"][axis], b["max_in"][axis], line, outward, p["ridge_z_in"]


def _lap_solid(bm, point, row, a0, a1, a0_top, a1_top):
    """One lap board: a wedge from the wall plane out to its proud lower edge, ending at a0..a1 at its foot and a0_top..a1_top at its top."""
    ends = []
    for foot, top in ((a0, a0_top), (a1, a1_top)):
        ends.append([bm.verts.new(_v(point(a, o, z))) for a, o, z in
                     ((foot, -laps.SINK_IN, row["z0"]), (foot, row["out0"], row["z0"]), (top, row["out1"], row["z1"]), (top, -laps.SINK_IN, row["z1"]))])
    lo, hi = ends
    faces = [bm.faces.new((lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i])) for i in range(4)]
    faces += [bm.faces.new(lo), bm.faces.new(hi[::-1])]
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def _siding_laps(spec, eds, prisms, siding):
    """Lap boards on every wall panel and gable end, in one object laid over the flat wall; the wall itself is left as it is."""
    wall = prisms[0]["wall_in"]
    holes = openings(spec)
    bm = bmesh.new()
    for e in eds:
        point = lambda a, o, z, e=e: _wall_point(e, a, o, z)
        for a0, a1, z0, z1 in wall_panels(e["length_in"], wall, holes.get(e["side"], [])):
            for row in laps.boards(z0, z1, wall):
                _lap_solid(bm, point, row, a0, a1, a0, a1)
    for axis, s0, s1, line, outward, apex in _gables(spec, prisms):
        def point(a, o, z, axis=axis, line=line, outward=outward):
            q = [0.0, 0.0, z]
            q[axis], q[1 - axis] = a, line + outward * o
            return q
        for row in laps.gable_boards(wall, apex, s0, s1):
            _lap_solid(bm, point, row, row["a0"], row["a1"], row["a0_top"], row["a1_top"])
    _mesh_object("House siding laps", bm).data.materials.append(siding)


def _corner_trim(eds, wall, trim):
    bm = bmesh.new()
    for i, e in enumerate(eds):
        p = eds[i - 1]
        if p["u"][0] * e["u"][1] - p["u"][1] * e["u"][0] >= 0:
            continue
        (cx, cy), out = e["start"], (p["n"][0] + e["n"][0], p["n"][1] + e["n"][1])
        xs, ys = (cx + out[0], cx - out[0] * 4.5), (cy + out[1], cy - out[1] * 4.5)
        _box(bm, (min(xs), min(ys), 0), (max(xs), max(ys), wall))
    _mesh_object("Corner trim", bm).data.materials.append(trim)


def _roofs(spec, prisms, manifests, trim, tile_m=None):
    look = spec["look"]["roof"]
    for k, p in enumerate(prisms, 1):
        axis = 1 if p["ridge"] == "east_west" else 0
        name = "Roof paint " + p["ridge"]
        asphalt = {"normal": SHINGLE_NORMAL, "rough_floor": SHINGLE_ROUGH, "specular": SHINGLE_SPECULAR} if tile_m else {}
        mat = bpy.data.materials.get(name) or painted_material(name, manifests[look["material"]], look["colour"], look["tint"], ROOF_GRAIN,
                                                               size_m=tile_m, turn_deg=0 if axis else 90, **asphalt)
        bm = bmesh.new()
        faces = _gable_slab(bm, axis, p["lo"][axis], p["hi"][axis], p["lo"][1 - axis], p["hi"][1 - axis], p["eave_z_in"], p["ridge_z_in"], ROOF_THICK_IN)
        for f in faces[2:]:
            f.material_index = 1
        obj = _mesh_object("Roof %d" % k, bm)
        obj.data.materials.append(mat)
        obj.data.materials.append(trim)


def _gutter_outline(width):
    """The outside of a K style gutter as (out, up) points from the top of the back down, along the bottom and up the front's ogee."""
    t = GUTTER_TALL_IN
    return [(0.0, t), (0.0, 0.5), (0.25, 0.1), (0.6, 0.0), (width - 1.7, 0.0), (width - 1.0, 0.1), (width - 0.3, 0.7), (width, 1.5),
            (width, 2.1), (width - 0.45, 2.7), (width - 0.5, 3.3), (width - 0.1, 3.9), (width, 4.5), (width - 0.4, t), (width - 0.9, t)]


def _gutter_sheet(outline):
    """The inside of the outline, one sheet thickness in on the open side."""
    inner = []
    for i, (v, z) in enumerate(outline):
        turns = []
        for a, b in ((i - 1, i), (i, i + 1)):
            if 0 <= a and b < len(outline):
                dv, dz = outline[b][0] - outline[a][0], outline[b][1] - outline[a][1]
                turns.append(Vector((-dz, dv)).normalized())
        n = sum(turns, Vector((0.0, 0.0))).normalized()
        push = GUTTER_WALL_IN / max(0.6, n.dot(turns[0]))
        inner.append((v + n.x * push, z + n.y * push))
    return inner


def _gutters(spec):
    width = spec["house"]["roof"]["eave_in"]
    out = {"west": (-1, 0), "east": (1, 0), "south": (0, -1), "north": (0, 1)}
    paint = plain_material("Gutter paint", *GUTTER_PAINT)
    for k, g in enumerate(house_spec.gutter_runs(spec), 1):
        (x0, y0), (x1, y1), (ox, oy) = g["start"], g["end"], out[g["facing"]]
        run = math.hypot(x1 - x0, y1 - y0)
        ux, uy = (x1 - x0) / run, (y1 - y0) / run
        bottom = g["z_in"] - GUTTER_TALL_IN
        outline = _gutter_outline(width)
        loop = outline + _gutter_sheet(outline)[::-1]
        bm = bmesh.new()
        rings = [[bm.verts.new(_v((x0 + ux * u + ox * v, y0 + uy * u + oy * v, bottom + z))) for v, z in loop] for u in (0.0, run)]
        for i in range(len(loop)):
            j = (i + 1) % len(loop)
            bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
        bm.faces.new(rings[0])
        bm.faces.new(rings[1][::-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        _mesh_object("Gutter %d" % k, bm).data.materials.append(paint)


def _downspouts(spec):
    paint = plain_material("Gutter paint", *GUTTER_PAINT)
    for k, d in enumerate(downspout.plan(spec), 1):
        bm = bmesh.new()
        rings = [[bm.verts.new(_v(p)) for p in ring] for ring in d["rings"]]
        for a, b in zip(rings, rings[1:]):
            for i in range(4):
                bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1][::-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        _mesh_object("Downspout %d" % k, bm).data.materials.append(paint)


def _chimney(spec, by_side, siding, trim):
    c = spec["house"]["features"].get("chimney")
    if not c:
        return
    w, d, h = c["size_in"]
    x0, y0, x1, y1 = house_spec.plan_rect(by_side[c["side"]], c["along_in"], 0, w, d)
    bm = bmesh.new()
    _box(bm, (x0, y0, 0), (x1, y1, h))
    _mesh_object("Chimney", bm).data.materials.append(siding)
    bm = bmesh.new()
    _box(bm, (x0 - 1.5, y0 - 1.5, h), (x1 + 1.5, y1 + 1.5, h + 3))
    _mesh_object("Chimney cap", bm).data.materials.append(trim)
    bm = bmesh.new()
    _rod(bm, ((x0 + x1) / 2.0, (y0 + y1) / 2.0, h + 3), ((x0 + x1) / 2.0, (y0 + y1) / 2.0, h + 14), 3, 3, 12)
    _mesh_object("Chimney flue", bm).data.materials.append(plain_material("Flue", *ACCENTS["Flue"]))


def _vents(spec, by_side):
    grille = plain_material("Vent grille", *ACCENTS["Vent grille"])
    for k, v in enumerate(spec["house"]["features"].get("foundation_vents", []), 1):
        e, w, z0, z1 = by_side[v["side"]], v["width_in"], v["elevation_in"], v["elevation_in"] + v["height_in"]
        bm = bmesh.new()

        def part(a0, a1, depth, lo_z, hi_z):
            x0, y0, x1, y1 = house_spec.plan_rect(e, v["along_in"] + a0, 0, a1 - a0, depth)
            _box(bm, (x0, y0, lo_z), (x1, y1, hi_z))

        part(0, w, 0.4, z0, z1)
        for a0, a1, lo_z, hi_z in ((0, 1, z0, z1), (w - 1, w, z0, z1), (0, w, z0, z0 + 1), (0, w, z1 - 1, z1)):
            part(a0, a1, 1.0, lo_z, hi_z)
        for i in range(1, 4):
            z = z0 + (z1 - z0) * i / 4.0
            part(1, w - 1, 0.9, z - 0.3, z + 0.3)
        _mesh_object("Vent %d" % k, bm).data.materials.append(grille)


def _door(spec, key, name, by_side, trim):
    door = spec[key]
    e = by_side[door["side"]]
    near = house_spec.plan_rect(e, door["along_in"], 0, door["width_in"], 12)
    base = max([s["height_in"] for s in spec["structures"]
                if s["kind"] in house_spec.STEPPED and house_spec._overlap(near, tuple(s["min_in"]) + tuple(s["max_in"]))] + [0])
    x0, y0, x1, y1 = house_spec.plan_rect(e, door["along_in"], 0, door["width_in"], 1.25)
    bm = bmesh.new()
    _box(bm, (x0, y0, base), (x1, y1, base + door["height_in"]))
    _mesh_object(name, bm).data.materials.append(trim)
    x0, y0, x1, y1 = house_spec.plan_rect(e, door["along_in"] + door["width_in"] - 5, 1.25, 2, 2)
    bm = bmesh.new()
    _box(bm, (x0, y0, base + 36), (x1, y1, base + 38))
    _mesh_object(name + " knob", bm).data.materials.append(plain_material("Flue", *ACCENTS["Flue"]))


def _wall_box(bm, e, a0, a1, out, z0, z1):
    x0, y0, x1, y1 = house_spec.plan_rect(e, a0, 0, a1 - a0, out)
    _box(bm, (x0, y0, z0), (x1, y1, z1))


def _frame(bm, e, a0, a1, z0, z1, sill):
    f = FRAME_IN
    low = z0 - f if sill else z0
    for b0, b1, lo, hi in ((a0 - f, a0, low, z1 + f), (a1, a1 + f, low, z1 + f), (a0, a1, z1, z1 + f)):
        _wall_box(bm, e, b0, b1, FRAME_PROUD_IN, lo, hi)
    if sill:
        _wall_box(bm, e, a0, a1, FRAME_PROUD_IN, low, z0)


def _wall_point(e, a, o, z):
    return (e["start"][0] + e["u"][0] * a + e["n"][0] * o, e["start"][1] + e["u"][1] * a + e["n"][1] * o, z)


def _wall_quad(bm, e, a0, a1, o, z0, z1):
    return bm.faces.new([bm.verts.new(_v(_wall_point(e, a, o, z))) for a, z in ((a0, z0), (a0, z1), (a1, z1), (a1, z0))])


def openings(spec):
    out = {}
    for w in spec["house"]["features"].get("windows", []):
        out.setdefault(w["side"], []).append((w["along_in"], w["along_in"] + w["width_in"], w["sill_in"], w["sill_in"] + w["height_in"]))
    return out


def wall_panels(length, height, holes):
    cuts_a = sorted({0.0, float(length)} | {h[i] for h in holes for i in (0, 1) if 0 < h[i] < length})
    cuts_z = sorted({0.0, float(height)} | {h[i] for h in holes for i in (2, 3) if 0 < h[i] < height})
    out = []
    for a0, a1 in zip(cuts_a, cuts_a[1:]):
        for z0, z1 in zip(cuts_z, cuts_z[1:]):
            am, zm = (a0 + a1) / 2.0, (z0 + z1) / 2.0
            if not any(h[0] < am < h[1] and h[2] < zm < h[3] for h in holes):
                out.append((a0, a1, z0, z1))
    return out


def _room(bm, e, a0, a1, z0, z1):
    back = -ROOM_DEPTH_IN
    v = {(a, o, z): bm.verts.new(_v(_wall_point(e, a, o, z))) for a in (a0, a1) for o in (back, 0.0) for z in (z0, z1)}
    for quad in (((a0, back, z0), (a1, back, z0), (a1, back, z1), (a0, back, z1)),
                 ((a0, 0.0, z0), (a0, back, z0), (a0, back, z1), (a0, 0.0, z1)),
                 ((a1, back, z0), (a1, 0.0, z0), (a1, 0.0, z1), (a1, back, z1)),
                 ((a0, 0.0, z0), (a1, 0.0, z0), (a1, back, z0), (a0, back, z0)),
                 ((a0, back, z1), (a1, back, z1), (a1, 0.0, z1), (a0, 0.0, z1))):
        bm.faces.new([v[p] for p in quad])


def _windows(spec, by_side, trim):
    glass = glass_material()
    room = plain_material("Window room", *ACCENTS["Window room"])
    for k, w in enumerate(spec["house"]["features"].get("windows", []), 1):
        e, a0, z0 = by_side[w["side"]], w["along_in"], w["sill_in"]
        a1, z1, mid = a0 + w["width_in"], z0 + w["height_in"], a0 + w["width_in"] / 2.0
        bm = bmesh.new()
        _wall_quad(bm, e, a0, a1, -GLASS_SET_BACK_IN, z0, z1)
        pane = _mesh_object("Window %d glass" % k, bm)
        pane.data.materials.append(glass)
        pane.visible_shadow = False
        bm = bmesh.new()
        _room(bm, e, a0, a1, z0, z1)
        _mesh_object("Window %d room" % k, bm).data.materials.append(room)
        bm = bmesh.new()
        _frame(bm, e, a0, a1, z0, z1, True)
        _wall_box(bm, e, mid - FRAME_IN / 4.0, mid + FRAME_IN / 4.0, FRAME_PROUD_IN / 2.0, z0, z1)
        _mesh_object("Window %d frame" % k, bm).data.materials.append(trim)


def _garage_door(spec, by_side, trim, siding=None):
    g = spec["house"]["features"].get("garage_door")
    if not g:
        return
    e, a0, a1, top = by_side[g["side"]], g["along_in"], g["along_in"] + g["width_in"], g["height_in"]
    paint = siding or plain_material("Garage door paint", spec["look"]["siding"]["colour"], 0.6)
    bm = bmesh.new()
    _wall_box(bm, e, a0, a1, GLASS_OUT_IN * 2, 0, top)
    _mesh_object("Garage door", bm).data.materials.append(paint)
    bm = bmesh.new()
    cols = max(2, int(round(g["width_in"] / GARAGE_PANEL_IN)))
    cw, rh = g["width_in"] / float(cols), top / float(GARAGE_ROWS)
    for i in range(cols):
        for j in range(GARAGE_ROWS):
            _wall_box(bm, e, a0 + i * cw + PANEL_INSET_IN, a0 + (i + 1) * cw - PANEL_INSET_IN, PANEL_PROUD_IN, j * rh + PANEL_INSET_IN, (j + 1) * rh - PANEL_INSET_IN)
    _mesh_object("Garage door panels", bm).data.materials.append(paint)
    bm = bmesh.new()
    _frame(bm, e, a0, a1, 0, top, False)
    _mesh_object("Garage door frame", bm).data.materials.append(trim)


def _ground_cover(spec):
    bm = bmesh.new()
    for tuft in route.ground_cover(spec):
        for blade in tuft["blades"]:
            bm.faces.new([bm.verts.new(_v(p)) for p in blade])
    _mesh_object("Ground cover", bm).data.materials.append(plain_material("Dry tufts", *ACCENTS["Dry tufts"]))


def _blade_mesh(name, rows):
    n = len(rows)
    base, tip, mid, half = rows["base"], rows["tip"], rows["mid"], rows["half"]
    z = rows["z"]
    quad = [base - half, base + half, mid + half * 0.7, mid - half * 0.7, tip]
    heights = [numpy.zeros_like(z), numpy.zeros_like(z), z * 0.55, z * 0.55, z]
    pts = numpy.stack([numpy.concatenate([q, h[..., None]], axis=-1) for q, h in zip(quad, heights)], axis=2)
    pts = pts.reshape(-1, 3) * in_to_m(1.0)
    count = pts.shape[0] // 5
    first = numpy.arange(count) * 5
    tris = numpy.stack([numpy.stack([first, first + 1, first + 2], 1), numpy.stack([first, first + 2, first + 3], 1),
                        numpy.stack([first + 3, first + 2, first + 4], 1)], 1).reshape(-1, 3)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(pts))
    mesh.vertices.foreach_set("co", pts.astype(numpy.float32).ravel())
    mesh.loops.add(len(tris) * 3)
    mesh.loops.foreach_set("vertex_index", tris.astype(numpy.int32).ravel())
    mesh.polygons.add(len(tris))
    mesh.polygons.foreach_set("loop_start", numpy.arange(len(tris), dtype=numpy.int32) * 3)
    mesh.polygons.foreach_set("loop_total", numpy.full(len(tris), 3, dtype=numpy.int32))
    mesh.update()
    return mesh


def _meadow(spec):
    tufts = meadow.tufts(spec)
    gen = numpy.random.default_rng(zlib_seed(spec["id"]))
    at = numpy.array([t["at_in"] for t in tufts])
    tall = numpy.array([t["tall_in"] for t in tufts])
    lean = numpy.array([t["lean"] for t in tufts])
    tone = numpy.array([t["tone"] for t in tufts])
    for k in range(meadow.TONES):
        keep = tone == k
        m, count = int(keep.sum()), meadow.BLADES
        if not m:
            continue
        base = at[keep][:, None, :] + gen.uniform(-3.0, 3.0, (m, count, 2))
        height = tall[keep][:, None] * gen.uniform(0.65, 1.0, (m, count))
        sway = lean[keep][:, None, :] * gen.uniform(0.5, 1.3, (m, count, 1)) + gen.normal(0.0, 1.2, (m, count, 2))
        angle = gen.uniform(0.0, math.pi, (m, count))
        half = numpy.stack([numpy.cos(angle), numpy.sin(angle)], -1) * BLADE_HALF_IN
        rows = {"base": base, "tip": base + sway, "mid": base + sway * 0.3, "half": half, "z": height}
        obj = _link(bpy.data.objects.new("Meadow %d" % k, _blade_mesh("Meadow %d" % k, rows)))
        obj.data.materials.append(plain_material("Meadow %d" % k, MEADOW_TONES[k], 0.85))


def zlib_seed(text):
    return sum(ord(c) * (i + 1) for i, c in enumerate(text))


def _spaced(a, b, step):
    n = max(1, int(math.ceil((b - a) / float(step))))
    return [a + (b - a) * i / float(n) for i in range(n + 1)]


def _steps(bm, s, structures):
    lo, hi, top = s["min_in"], s["max_in"], s["height_in"]
    axis, sign = 1, -1
    for t in structures:
        if t is s or t["kind"] not in house_spec.STEPS_LEAD_TO or not house_spec._abut(s, t):
            continue
        for ax in (0, 1):
            if hi[ax] == t["min_in"][ax]:
                axis, sign = ax, -1
            elif lo[ax] == t["max_in"][ax]:
                axis, sign = ax, 1
    n = max(1, int(round(top / float(STEP_RISE_IN))) - 1)
    depth = (hi[axis] - lo[axis]) / float(n)
    for k in range(n):
        a, b = list(lo), list(hi)
        if sign > 0:
            a[axis] = lo[axis] + k * depth
            b[axis] = a[axis] + depth
        else:
            b[axis] = hi[axis] - k * depth
            a[axis] = b[axis] - depth
        _box(bm, (a[0], a[1], 0), (b[0], b[1], top * (n - k) / (n + 1.0)))


def _structure(s, structures, paints=None, tagged=()):
    (x0, y0), (x1, y1), top = s["min_in"], s["max_in"], s["height_in"]
    bm = bmesh.new()
    if s["kind"] == "steps":
        _steps(bm, s, structures)
    elif s["kind"] == "deck":
        _box(bm, (x0, y0, top - 2), (x1, y1, top))
        for x in _spaced(x0 + 2, x1 - 2, 96):
            for y in _spaced(y0 + 2, y1 - 2, 96):
                _box(bm, (x - 2, y - 2, 0), (x + 2, y + 2, top - 2))
    else:
        _box(bm, (x0, y0, 0), (x1, y1, max(top, 0.4)))
    mat = (paints or {}).get(s["material"])
    if mat is None:
        colour, rough, metal = STRUCTURE_LOOK[s["material"]]
        mat = plain_material(s["material"].capitalize(), colour, rough, metal)
    obj = _mesh_object(s["id"], bm)
    obj.data.materials.append(mat)
    if s["id"] in tagged:
        obj[HAZARD_TAG] = s["id"]


def _ground_material(ground, manifests):
    mat = node_owner(bpy.data.materials.new("Ground"))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    coord = nodes.new("ShaderNodeTexCoord")

    def tex(manifest, key, colour):
        mapping = nodes.new("ShaderNodeMapping")
        w, h = manifest.get("size_m", [2.0, 2.0])
        mapping.inputs["Scale"].default_value = (1.0 / w, 1.0 / h, 1.0 / w)
        links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(manifest["files"][key], check_existing=True)
        node.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        node.projection = "BOX"
        node.projection_blend = 0.2
        links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    def tinted(manifest, tint):
        out = tex(manifest, "Diffuse", True).outputs["Color"]
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (tint[0], tint[1], tint[2], 1.0)
        links.new(out, mix.inputs[6])
        return mix.outputs[2]

    def mask(share, scale, seed):
        noise = nodes.new("ShaderNodeTexNoise")
        noise.noise_dimensions = "4D"
        noise.inputs["Scale"].default_value = scale
        noise.inputs["W"].default_value = seed
        noise.inputs["Detail"].default_value = 4.0
        links.new(coord.outputs["Object"], noise.inputs["Vector"])
        edge = nodes.new("ShaderNodeMapRange")
        low = GROUND_EDGE_MID - share * GROUND_EDGE_SPAN
        edge.inputs["From Min"].default_value = low
        edge.inputs["From Max"].default_value = low + GROUND_EDGE_SOFT
        links.new(noise.outputs["Fac"], edge.inputs["Value"])
        return edge.outputs["Result"]

    colour = tinted(manifests[ground["material"]], ground["tint"])
    for n, patch in enumerate(ground.get("mix", [])):
        over = nodes.new("ShaderNodeMix")
        over.data_type = "RGBA"
        links.new(mask(patch["share"], GROUND_NOISE_M[n % 2], 10.0 * (n + 1)), over.inputs[0])
        links.new(colour, over.inputs[6])
        links.new(tinted(manifests[patch["material"]], patch.get("tint", (1.0, 1.0, 1.0))), over.inputs[7])
        colour = over.outputs[2]
    links.new(colour, bsdf.inputs["Base Color"])
    base = manifests[ground["material"]]
    links.new(tex(base, "Rough", False).outputs["Color"], bsdf.inputs["Roughness"])
    normal = nodes.new("ShaderNodeNormalMap")
    links.new(tex(base, "nor_gl", False).outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _lot_ground(spec, mat, pad_in=0):
    (x0, y0), (x1, y1) = spec["lot"]["min_in"], spec["lot"]["max_in"]
    x0, y0, x1, y1 = x0 - pad_in, y0 - pad_in, x1 + pad_in, y1 + pad_in
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(_v(p)) for p in ((x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0))])
    _mesh_object("Ground", bm).data.materials.append(mat)


def _flat(name, corners, rise, mat):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(_v((x, y, rise))) for x, y in corners])
    _mesh_object(name, bm).data.materials.append(mat)


def _front_yard(spec, catalog, manifests, concrete):
    bed = yard.bed_polygon(spec)
    if bed:
        _flat("Front bed", bed, BED_RISE_IN, pbr_material("Front bed", manifests[yard.bed_material(spec)]))
    walk = yard.walk_polygon(spec)
    if walk and concrete is not None:
        _flat("Front walk", walk, WALK_RISE_IN, concrete)
    options = photoscan.variants(catalog[yard.SHRUB_ASSET])
    for n, s in enumerate(yard.shrubs(spec)):
        variant = photoscan.choose(options, "%s shrub %d" % (spec["id"], n))
        objs, lo, hi = photomodel.instance(manifests[variant["id"]], variant, _link)
        holder = _link(bpy.data.objects.new("Bed shrub %d fit" % n, None))
        (x, y), (w, d, z) = s["at_in"], s["size_in"]
        photomodel.fit(holder, lo, hi, ((x - w / 2.0, y - d / 2.0, BED_RISE_IN), (x + w / 2.0, y + d / 2.0, BED_RISE_IN + z)), "stretch")
        for k, o in enumerate(objs):
            o.name = "Bed shrub %d" % n if k == 0 else "Bed shrub %d part %d" % (n, k)
            o.parent = holder
            o[PHOTO_TAG] = True


def _woods(spec, catalog, manifests):
    for tree in woods.ring(spec):
        _photo_tree(tree, photoscan.variants(catalog[woods.LOT_FORMS], tree["form"]), manifests)


def house_render_settings(spec, motion, samples):
    cam = motion["camera"]
    walk = {"width_px": cam["width_px"], "height_px": cam["height_px"], "fps": motion["fps"], "duration_s": 1}
    render_settings({"walk": walk, "label": spec["label"]}, samples)
    scene = bpy.context.scene
    scene.frame_end = motion["frame_count"]
    scene.eevee.use_raytracing = True
    scene.eevee.use_fast_gi = True
    scene.eevee.fast_gi_method = "GLOBAL_ILLUMINATION"
    scene.view_settings.exposure = HOUSE_EXPOSURE
    if spec["look"].get("photoscans"):
        for name in PHOTO_VIEW:
            try:
                scene.view_settings.view_transform = name
                break
            except TypeError:
                continue
        scene.view_settings.look = "None"


def final_settings():
    scene = bpy.context.scene
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
    except TypeError:
        prefs.compute_device_type = "NONE"
    prefs.refresh_devices()
    kind, gpus = engine.device([{"name": d.name, "type": d.type} for d in prefs.devices])
    for d in prefs.devices:
        d.use = d.name in gpus
    f = engine.FINAL
    scene.render.engine = f["engine"]
    scene.cycles.device = kind
    scene.cycles.samples = f["samples"]
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = f["adaptive_threshold"]
    scene.cycles.adaptive_min_samples = f["adaptive_min_samples"]
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = f["denoiser"]
    scene.cycles.denoising_use_gpu = kind == "GPU"
    scene.render.use_persistent_data = f["persistent_data"]
    return {"engine": scene.render.engine, "device": kind, "gpus": gpus, "samples": scene.cycles.samples,
            "adaptive": scene.cycles.use_adaptive_sampling, "adaptive_threshold": scene.cycles.adaptive_threshold,
            "denoiser": scene.cycles.denoiser if scene.cycles.use_denoising else None,
            "persistent_data": scene.render.use_persistent_data}


def build_house(spec, catalog, manifests, motion, samples=16, findings=()):
    reset()
    bpy.context.scene.unit_settings.system = "IMPERIAL"
    look = spec["look"]
    eds = house_spec.edges(spec)
    by_side = {e["side"]: e for e in eds}
    prisms = house_spec.roof_prisms(spec)
    lapped = bool(look.get("photoscans"))
    siding = painted_material("Siding paint", manifests[look["siding"]["material"]], look["siding"]["colour"], look["siding"]["tint"],
                              SIDING_GRAIN, size_m=SIDING_TILE_M, normal=LAPPED_NORMAL if lapped else 1.0,
                              band_m=in_to_m(laps.pitch(prisms[0]["wall_in"])) if lapped else 0.0)
    trim = plain_material("Trim paint", look["trim"]["colour"], 0.55)
    light = look["light"]
    world(manifests[light["hdri"]], light["rotation_deg"], light.get("sky"), light.get("warm"))
    _house_walls(spec, eds, prisms, siding)
    if lapped:
        _siding_laps(spec, eds, prisms, siding)
    _corner_trim(eds, prisms[0]["wall_in"], trim)
    _roofs(spec, prisms, manifests, trim, ROOF_TILE_M if look.get("photoscans") else None)
    _gutters(spec)
    _downspouts(spec)
    _chimney(spec, by_side, siding, trim)
    _vents(spec, by_side)
    for key, name in (("front_door", "Front door"), ("back_door", "Back door")):
        if key in spec:
            _door(spec, key, name, by_side, trim)
    _windows(spec, by_side, trim)
    _garage_door(spec, by_side, trim, siding if look.get("photoscans") else None)
    paints = {}
    if "concrete" in look:
        paints["concrete"] = pbr_material("Concrete texture", manifests[look["concrete"]["material"]], look["concrete"]["tint"])
    if any(house_spec.burns(s) for s in spec["structures"]):
        paints[house_spec.WOOD] = pbr_material("Wood planks", manifests[house_spec.WOOD_TEXTURE])
    for s in spec["structures"]:
        _structure(s, spec["structures"], paints, findings)
    photo = bool(look.get("photoscans"))
    if photo:
        _lot_ground(spec, _ground_material(look["ground"], manifests), WOODS_PAD_IN)
        _front_yard(spec, catalog, manifests, paints.get("concrete"))
        _meadow(spec)
    else:
        _lot_ground(spec, pbr_material("Ground", manifests[look["ground"]["material"]], look["ground"]["tint"]))
    _ground_cover(spec)
    cache = {}
    standoff = route.params(spec)["standoff_in"]
    trees = spec.get("trees", [])
    carried = {b for t in trees for b in t["branches"]}
    placed = {h["id"]: h for h in spec["hazards"] + spec.get("fixed", [])}
    for h in placed.values():
        place_hazard(h, by_side[h["side"]], catalog, manifests, cache, photo)
        if h["asset"] == "scripted:overhanging_branch" and h["id"] not in carried:
            oaks = photoscan.variants(catalog.get("scripted:lot_tree", {}), "oak") if photo else []
            args = (h, by_side[h["side"]], standoff, cache[h["asset"]], random.Random(h["id"] + " support"))
            _photo_support(*args, oaks, manifests) if oaks else _branch_support(*args)
    for t in trees:
        at = t["at_in"]
        joints = [[a - b for a, b in zip(branch_root(placed[b], by_side[placed[b]["side"]]), (at[0], at[1], 0))] for b in t["branches"] if b in placed]
        place_tree(t, catalog[t["asset"]], manifests, cache, joints, photo)
    if photo:
        _woods(spec, catalog, manifests)
    photomodel.release()
    camera(motion)
    house_render_settings(spec, motion, samples)
    if light.get("haze"):
        haze_pass(bpy.context.scene, light["haze"])
    if light.get("fill"):
        fill_light(light["fill"])
