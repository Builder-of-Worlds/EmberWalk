# blender --background --factory-startup --python-exit-code 1 HERO.blend --python blender/walled_scene.py -- build OUT.blend
# blender --background --factory-startup --python-exit-code 1 WALLED.blend --python blender/walled_scene.py -- frames motion.json DIR FIRST LAST
# blender --background --factory-startup --python-exit-code 1 WALLED.blend --python blender/walled_scene.py -- masks motion.json boxes.json
# build adds the walled house's block wall and two wood fences (ewscene/walled.py) to the hero's final scene; frames draws the
# walk with the hero lap's camera, look and deck at EW_SAMPLES (default 64) and EW_SIZE (default 1920x1080), keeping frames already
# drawn; masks writes the flat colour pass of every frame for the truth boxes.
import json
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy
from mathutils import Matrix

from ewscene import blendscene, deckboards, finalshots, geom, output, walled
from ewscene.units import in_to_m

argv = sys.argv[sys.argv.index("--") + 1:]
MODE = argv[0]
BLOCK_IN = (16, 8)
CAP_IN = 2


def block_material():
    # Grey blocks in a running bond with a mottled, pitted face and recessed mortar joints.
    mat = blendscene.node_owner(bpy.data.materials.new("Concrete block wall"))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    coord = nodes.new("ShaderNodeTexCoord")
    split, face = nodes.new("ShaderNodeSeparateXYZ"), nodes.new("ShaderNodeCombineXYZ")
    links.new(coord.outputs["Object"], split.inputs["Vector"])
    for a, b in (("Y", "X"), ("Z", "Y"), ("X", "Z")):
        links.new(split.outputs[a], face.inputs[b])
    brick = nodes.new("ShaderNodeTexBrick")
    brick.offset_frequency = 2
    brick.inputs["Color1"].default_value = [*blendscene.linear_rgb("#a9a79f"), 1.0]
    brick.inputs["Color2"].default_value = [*blendscene.linear_rgb("#97958d"), 1.0]
    brick.inputs["Mortar"].default_value = [*blendscene.linear_rgb("#b9b6ad"), 1.0]
    brick.inputs["Bias"].default_value = 0.3
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = in_to_m(0.375)
    brick.inputs["Brick Width"].default_value = in_to_m(BLOCK_IN[0])
    brick.inputs["Row Height"].default_value = in_to_m(BLOCK_IN[1])
    links.new(face.outputs["Vector"], brick.inputs["Vector"])
    mottle = nodes.new("ShaderNodeTexNoise")
    mottle.inputs["Scale"].default_value = 9.0
    mottle.inputs["Detail"].default_value = 10.0
    tone = nodes.new("ShaderNodeMapRange")
    tone.inputs["To Min"].default_value = 0.72
    tone.inputs["To Max"].default_value = 1.12
    links.new(face.outputs["Vector"], mottle.inputs["Vector"])
    links.new(mottle.outputs["Fac"], tone.inputs["Value"])
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    links.new(brick.outputs["Color"], shade.inputs[6])
    links.new(tone.outputs["Result"], shade.inputs[7])
    links.new(shade.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    pits = nodes.new("ShaderNodeTexNoise")
    pits.inputs["Scale"].default_value = 400.0
    pits.inputs["Detail"].default_value = 4.0
    links.new(face.outputs["Vector"], pits.inputs["Vector"])
    grain = nodes.new("ShaderNodeBump")
    grain.inputs["Strength"].default_value = 0.35
    grain.inputs["Distance"].default_value = in_to_m(0.05)
    links.new(pits.outputs["Fac"], grain.inputs["Height"])
    joint = nodes.new("ShaderNodeBump")
    joint.invert = True
    joint.inputs["Strength"].default_value = 0.8
    joint.inputs["Distance"].default_value = in_to_m(0.3)
    links.new(brick.outputs["Fac"], joint.inputs["Height"])
    links.new(grain.outputs["Normal"], joint.inputs["Normal"])
    links.new(joint.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def fence_material():
    for o in bpy.data.objects:
        if o.get(blendscene.HAZARD_TAG) == "fence-at-siding" and o.type == "MESH" and o.data.materials:
            return o.data.materials[0]
    raise SystemExit("EW_ERROR the hero scene has no fence-at-siding material to copy")


def add(name, bm, mat, matrix):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = matrix
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build(out):
    rng = random.Random(445)
    wood, block = fence_material(), block_material()
    for o in walled.OBSTACLES:
        lo, hi = o["min_in"], o["max_in"]
        along_x = hi[0] - lo[0] > hi[1] - lo[1]
        run = (hi[0] - lo[0]) if along_x else (hi[1] - lo[1])
        thick = (hi[1] - lo[1]) if along_x else (hi[0] - lo[0])
        height = hi[2] - lo[2]
        bm = bmesh.new()
        if o["kind"] == "block_wall":
            blendscene._box(bm, (0, 0, -2), (thick, run, height - CAP_IN))
            blendscene._box(bm, (-0.75, -0.75, height - CAP_IN), (thick + 0.75, run + 0.75, height))
            mat = block
        else:
            bm = blendscene._wood_fence((thick, run, height), rng)
            mat = wood
        if along_x:
            matrix = Matrix.Translation((in_to_m(lo[0]), in_to_m(hi[1]), 0.0)) @ Matrix.Rotation(-math.pi / 2, 4, "Z")
        else:
            matrix = Matrix.Translation((in_to_m(lo[0]), in_to_m(lo[1]), 0.0))
        add("walled-" + o["id"], bm, mat, matrix)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    print("EW_BUILT", out, flush=True)


def camera(m):
    scene = bpy.context.scene
    cam = bpy.data.objects["Phone"]
    cam.animation_data_clear()
    cam.rotation_mode = "QUATERNION"
    cam.data.lens = m["camera"]["focal_mm"]
    scene.camera = cam
    scene.frame_set(1)
    return scene, cam


def pose(cam, s, m):
    p = finalshots.still_pose(s, m["camera"])
    cam.location = p["location_m"]
    cam.rotation_quaternion = Matrix(geom.camera_rotation(p["heading_deg"], 0.0, 0.0)).to_quaternion()
    cam.data.shift_y = p["shift_y"]
    bpy.context.view_layer.update()


def frames(m, out, first, last):
    scene, cam = camera(m)
    w, h = (int(v) for v in os.environ.get("EW_SIZE", "1920x1080").split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    deckboards.swap_deck()
    blendscene.final_settings()
    scene.cycles.samples = int(os.environ.get("EW_SAMPLES", "64"))
    output.png(scene.render)
    scene.render.use_file_extension = False
    os.makedirs(out, exist_ok=True)
    for s in m["samples"][first - 1:last]:
        final = os.path.join(out, "frame-%05d.png" % s["frame"])
        if os.path.isfile(final) and os.path.getsize(final) > 0:
            continue
        pose(cam, s, m)
        scene.render.filepath = final + ".part"
        t = time.monotonic()
        bpy.ops.render.render(write_still=True)
        os.replace(final + ".part", final)
        print("EW_FRAME", s["frame"], round(time.monotonic() - t, 2), flush=True)


def masks(m, out):
    from ewscene import blendmask, maskbox, truth
    scene, cam = camera(m)
    w, h = m["camera"]["width_px"], m["camera"]["height_px"]
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    indices = blendmask.flat_colours(scene)
    still = os.path.join(os.path.dirname(os.path.abspath(out)), "mask-still.png")
    found = []
    for s in m["samples"]:
        pose(cam, s, m)
        scene.render.filepath = still
        bpy.ops.render.render(write_still=True)
        found.append({"frame": s["frame"], "boxes": maskbox.boxes(blendmask.classes(still, w, h), w, h, indices)})
    os.remove(still)
    with open(out + ".part", "w", encoding="utf-8") as f:
        json.dump({"schema": truth.PASS_SCHEMA, "width": w, "height": h, "indices": indices, "frames": found}, f)
    os.replace(out + ".part", out)


if MODE == "build":
    build(argv[1])
else:
    with open(argv[1], encoding="utf-8") as f:
        motion = json.load(f)
    if MODE == "frames":
        frames(motion, argv[2], int(argv[3]), int(argv[4]))
    elif MODE == "masks":
        masks(motion, argv[2])
    else:
        raise SystemExit("EW_ERROR unknown mode %s" % MODE)
print("EW_DONE", flush=True)
