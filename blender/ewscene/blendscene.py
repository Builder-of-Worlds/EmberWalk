import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from . import engine, fence, geom, house as house_spec, placement, route
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


def world(manifest, rotation_deg, sky=None):
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


SIDING_TILE_M = 2.2
SIDING_GRAIN = 0.15
ROOF_GRAIN = 0.85
ROOF_THICK_IN = 6
GUTTER_TALL_IN = 5
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
GARAGE_PANEL_IN = 24
PANEL_INSET_IN = 2.0
STRUCTURE_LOOK = {
    "concrete": ("#b9b4aa", 0.85, 0.0),
    "asphalt": ("#3d3d3c", 0.9, 0.0),
    "metal": ("#6a6d70", 0.45, 0.6),
    "gravel": ("#8f8b85", 1.0, 0.0),
    "masonry": ("#9a7f6b", 0.9, 0.0),
}
ACCENTS = {
    "Dry leaves": ("#6e4a2a", 0.8, 0.0),
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


def painted_material(name, manifest, hex_colour, tint, grain, size_m=None, turn_deg=0.0, normal=1.0, translucent=0.0):
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
    links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    links.new(image("Rough", False).outputs["Color"], bsdf.inputs["Roughness"])
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


def _blob(bm, centre, radii, rng, rough=0.25):
    c = _v(centre)
    m = Matrix.Translation(c) @ Matrix.Diagonal([in_to_m(r) for r in radii] + [1.0])
    for v in bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=m)["verts"]:
        v.co = c + (v.co - c) * rng.uniform(1.0 - rough, 1.0)


def _within(p, r, size):
    return [min(max(p[i], r[i]), size[i] - r[i]) for i in range(3)]


def _leaves(bm, centre, radii, rng, count, leaf, size=None):
    for _ in range(count):
        p = Vector([centre[i] + rng.gauss(0, 0.45) * radii[i] for i in range(3)])
        if size is not None:
            p = Vector(_within(p, (leaf, leaf, leaf), size))
        turn = Euler((rng.uniform(0, math.pi), rng.uniform(0, math.pi), rng.uniform(0, 2 * math.pi))).to_matrix()
        corners = [turn @ Vector((sx * leaf, sy * leaf * 0.55, 0.0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        bm.faces.new([bm.verts.new(_v(p + c)) for c in corners])


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


def _gutter_leaves(size, rng):
    w, d, h = size
    bm = bmesh.new()
    x = 0.0
    while x < w:
        r = rng.uniform(2.0, 3.5)
        cx = min(max(x + r * 0.6, r), w - r)
        _blob(bm, (cx, d * (0.5 + rng.uniform(-0.1, 0.1)), h * 0.5), (r, d * 0.42, h * 0.5 * rng.uniform(0.75, 1.0)), rng)
        x += r * rng.uniform(1.0, 1.5)
    return {"main": bm}


def _vent_leaf_mulch(size, rng):
    w, d, h = size
    bm = bmesh.new()
    nx, ny = 12, 6
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, t = i / float(nx), j / float(ny)
            jitter = rng.uniform(0.82, 1.0) if 0 < i < nx and j < ny else 1.0
            row.append(bm.verts.new(_v((w * u, d * t, h * math.sin(math.pi * u) ** 0.6 * (1 - t ** 1.5) * jitter))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    for _ in range(18):
        u, t = rng.uniform(0.2, 0.8), rng.uniform(0.0, 0.6)
        r = (rng.uniform(2.0, 3.5), rng.uniform(2.0, 3.5), rng.uniform(1.0, 2.0))
        z = h * math.sin(math.pi * u) ** 0.6 * (1 - t ** 1.5) - r[2]
        _blob(bm, _within((w * u, d * t, z), r, size), r, rng)
    return {"main": bm}


def _overhanging_branch(size, rng):
    w, d, h = size
    bark, leaves = bmesh.new(), bmesh.new()
    pts = [Vector((w * 0.5, d, h * 0.55))]
    for k in range(1, 5):
        t = k / 4.0
        pts.append(Vector((w * (0.5 + rng.uniform(-0.12, 0.12)), d * (1 - t), h * (0.55 - 0.25 * t + rng.uniform(-0.05, 0.05)))))
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        _rod(bark, a, b, 3.5 - 0.55 * k, 3.5 - 0.55 * (k + 1), 8)
    for _ in range(10):
        k = rng.randrange(1, len(pts))
        base = pts[k - 1].lerp(pts[k], rng.random())
        way = Vector((rng.choice((-1, 1)) * rng.uniform(0.4, 1.0), rng.uniform(-0.5, 0.3), rng.uniform(-0.1, 0.4))).normalized()
        r = (rng.uniform(6, 10), rng.uniform(6, 10), rng.uniform(3, 5))
        tip = Vector(_within(base + way * rng.uniform(14, 30), r, size))
        _rod(bark, base, tip, 0.9, 0.25, 5)
        _leaves(leaves, tip, r, rng, 45, 1.8, size)
    for p in pts[1:]:
        _leaves(leaves, p + Vector((0, 0, 3)), (8, 8, 4), rng, 30, 1.8, size)
    return {"main": bark, "Dry leaves": leaves}


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


HOUSE_SCRIPTED = {
    "scripted:wood_pile": lambda size, rng: {"main": _wood_pile(size, rng)},
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


def place_hazard(h, edge, catalog, manifests, cache):
    rng = random.Random(h["id"])
    entry = catalog[h["asset"]]
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
            _leaves(leaves, Vector(tip) + Vector((rng.uniform(-14, 14), rng.uniform(-14, 14), rng.uniform(-8, 8))), (12, 12, 7), rng, 70, 2.2)
    name = "Branch support " + h["id"]
    _mesh_object(name, wood).data.materials.append(bark)
    _mesh_object(name + " leaves", leaves).data.materials.append(plain_material("Live leaves", *ACCENTS["Live leaves"]))


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
    eave = spec["house"]["roof"]["eave_in"]
    for b, p in zip(spec["house"]["roof"]["blocks"], prisms):
        axis = 1 if p["ridge"] == "east_west" else 0
        run = 1 - axis
        for line, bound, outward in ((b["min_in"][run], p["lo"][run], -1), (b["max_in"][run], p["hi"][run], 1)):
            if bound == line + outward * eave:
                _gable_end(bm, axis, b["min_in"][axis], b["max_in"][axis], line, wall, p["ridge_z_in"], outward)
    body = _mesh_object("House wall", bm)
    body.data.materials.append(siding)
    body["ew_role"] = "wall"


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


def _roofs(spec, prisms, manifests, trim):
    look = spec["look"]["roof"]
    for k, p in enumerate(prisms, 1):
        axis = 1 if p["ridge"] == "east_west" else 0
        name = "Roof paint " + p["ridge"]
        mat = bpy.data.materials.get(name) or painted_material(name, manifests[look["material"]], look["colour"], look["tint"], ROOF_GRAIN, turn_deg=0 if axis else 90)
        bm = bmesh.new()
        faces = _gable_slab(bm, axis, p["lo"][axis], p["hi"][axis], p["lo"][1 - axis], p["hi"][1 - axis], p["eave_z_in"], p["ridge_z_in"], ROOF_THICK_IN)
        for f in faces[2:]:
            f.material_index = 1
        obj = _mesh_object("Roof %d" % k, bm)
        obj.data.materials.append(mat)
        obj.data.materials.append(trim)


def _gutters(spec, trim):
    width = spec["house"]["roof"]["eave_in"]
    out = {"west": (-width, 0), "east": (width, 0), "south": (0, -width), "north": (0, width)}
    for k, g in enumerate(house_spec.gutter_runs(spec), 1):
        (x0, y0), (x1, y1), (ox, oy) = g["start"], g["end"], out[g["facing"]]
        xs, ys = (x0, x1, x0 + ox, x1 + ox), (y0, y1, y0 + oy, y1 + oy)
        bm = bmesh.new()
        _box(bm, (min(xs), min(ys), g["z_in"] - GUTTER_TALL_IN), (max(xs), max(ys), g["z_in"]))
        _mesh_object("Gutter %d" % k, bm).data.materials.append(trim)


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


def _garage_door(spec, by_side, trim):
    g = spec["house"]["features"].get("garage_door")
    if not g:
        return
    e, a0, a1, top = by_side[g["side"]], g["along_in"], g["along_in"] + g["width_in"], g["height_in"]
    paint = plain_material("Garage door paint", spec["look"]["siding"]["colour"], 0.6)
    bm = bmesh.new()
    _wall_box(bm, e, a0, a1, GLASS_OUT_IN * 2, 0, top)
    _mesh_object("Garage door", bm).data.materials.append(paint)
    bm = bmesh.new()
    cols = max(2, int(round(g["width_in"] / GARAGE_PANEL_IN)))
    cw, rh = g["width_in"] / float(cols), top / float(GARAGE_ROWS)
    for i in range(cols):
        for j in range(GARAGE_ROWS):
            _wall_box(bm, e, a0 + i * cw + PANEL_INSET_IN, a0 + (i + 1) * cw - PANEL_INSET_IN, FRAME_PROUD_IN, j * rh + PANEL_INSET_IN, (j + 1) * rh - PANEL_INSET_IN)
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


def _structure(s, structures, paints=None):
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
    _mesh_object(s["id"], bm).data.materials.append(mat)


def _lot_ground(spec, mat):
    (x0, y0), (x1, y1) = spec["lot"]["min_in"], spec["lot"]["max_in"]
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(_v(p)) for p in ((x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0))])
    _mesh_object("Ground", bm).data.materials.append(mat)


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


def build_house(spec, catalog, manifests, motion, samples=16):
    reset()
    bpy.context.scene.unit_settings.system = "IMPERIAL"
    look = spec["look"]
    eds = house_spec.edges(spec)
    by_side = {e["side"]: e for e in eds}
    prisms = house_spec.roof_prisms(spec)
    siding = painted_material("Siding paint", manifests[look["siding"]["material"]], look["siding"]["colour"], look["siding"]["tint"],
                              SIDING_GRAIN, size_m=SIDING_TILE_M)
    trim = plain_material("Trim paint", look["trim"]["colour"], 0.55)
    world(manifests[look["light"]["hdri"]], look["light"]["rotation_deg"], look["light"].get("sky"))
    _house_walls(spec, eds, prisms, siding)
    _corner_trim(eds, prisms[0]["wall_in"], trim)
    _roofs(spec, prisms, manifests, trim)
    _gutters(spec, trim)
    _chimney(spec, by_side, siding, trim)
    _vents(spec, by_side)
    for key, name in (("front_door", "Front door"), ("back_door", "Back door")):
        if key in spec:
            _door(spec, key, name, by_side, trim)
    _windows(spec, by_side, trim)
    _garage_door(spec, by_side, trim)
    paints = {}
    if "concrete" in look:
        paints["concrete"] = pbr_material("Concrete texture", manifests[look["concrete"]["material"]], look["concrete"]["tint"])
    for s in spec["structures"]:
        _structure(s, spec["structures"], paints)
    _lot_ground(spec, pbr_material("Ground", manifests[look["ground"]["material"]], look["ground"]["tint"]))
    _ground_cover(spec)
    cache = {}
    standoff = route.params(spec)["standoff_in"]
    for h in spec["hazards"] + spec.get("fixed", []):
        place_hazard(h, by_side[h["side"]], catalog, manifests, cache)
        if h["asset"] == "scripted:overhanging_branch":
            _branch_support(h, by_side[h["side"]], standoff, cache[h["asset"]], random.Random(h["id"] + " support"))
    camera(motion)
    house_render_settings(spec, motion, samples)
