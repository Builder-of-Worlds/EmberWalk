# blender --background --factory-startup --python-exit-code 1 final/after.blend --python blender/final_aerial.py -- <code dir> <spec> <out png> [<samples>]
# One straight down orthographic still of the hero lot in the final look, house centred, for shot 17.
# The frame is a square FRAME_M metres wide inside the scanned yard grid (grass_plot.GRID_M); the whole lot and the 100 ft ring do not fit.
import json
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
CODE, SPEC, OUT = argv[:3]
SAMPLES = int(argv[3]) if len(argv) > 3 else 128
sys.path.insert(0, os.path.join(CODE, "blender"))

import bpy
from mathutils import Euler

from ewscene import blendscene, deckboards, finalshots, grass_plot, output, paths
from ewscene.deckboards import tint

paths.relink(bpy.data)

FRAME_M = 40.0
SIZE_PX = 2048
HEIGHT_M = 120.0

with open(SPEC, encoding="utf-8") as f:
    spec = json.load(f)
try:
    cx, cy = finalshots.aerial_centre(spec, FRAME_M, grass_plot.GRID_M)
except ValueError as e:
    raise SystemExit("EW_ERROR " + str(e))

ROOF_SCALE = float(os.environ.get("EW_ROOF_SCALE", "0.2"))


def top_down_look():
    deckboards.swap_deck()
    for mat in bpy.data.materials:
        if mat.use_nodes and mat.name.startswith("Roof paint"):
            for n in mat.node_tree.nodes:
                if n.type == "MAPPING":
                    n.inputs["Scale"].default_value = (ROOF_SCALE,) * 3
    conc = bpy.data.materials.get("Concrete texture")
    if conc is not None:
        tree = conc.node_tree
        bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
        noise = tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 0.6
        noise.inputs["Detail"].default_value = 8.0
        ramp = tree.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.38, 0.34, 0.3, 1)
        ramp.color_ramp.elements[1].color = (0.85, 0.83, 0.8, 1)
        tree.links.new(tree.nodes.new("ShaderNodeTexCoord").outputs["Object"], noise.inputs["Vector"])
        tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        tint(tree, bsdf, (0.72, 0.7, 0.66))
        stain = tree.nodes.new("ShaderNodeMix")
        stain.data_type, stain.blend_type = "RGBA", "MULTIPLY"
        stain.inputs["Factor"].default_value = 1.0
        tree.links.new(bsdf.inputs["Base Color"].links[0].from_socket, stain.inputs["A"])
        tree.links.new(ramp.outputs["Color"], stain.inputs["B"])
        tree.links.new(stain.outputs["Result"], bsdf.inputs["Base Color"])
    cover = bpy.data.objects.get("Ground cover")
    if cover is not None and os.environ.get("EW_AERIAL_COVER", "1") == "1":
        cover.hide_render = False


top_down_look()
scene = bpy.context.scene
data = bpy.data.cameras.new("Aerial")
data.type = "ORTHO"
data.ortho_scale = FRAME_M
data.clip_start = 1.0
data.clip_end = 400.0
data.shift_x = data.shift_y = 0.0
cam = bpy.data.objects.new("Aerial", data)
scene.collection.objects.link(cam)
cam.location = (cx, cy, HEIGHT_M)
cam.rotation_euler = Euler((0.0, 0.0, 0.0))
scene.camera = cam
scene.render.resolution_x = scene.render.resolution_y = SIZE_PX
scene.render.resolution_percentage = 100
blendscene.final_settings()
scene.cycles.samples = SAMPLES
if os.environ.get("EW_AERIAL_HAZE") != "1":
    scene.render.use_compositing = False
output.png(scene.render)
scene.render.use_file_extension = False
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("EW_AERIAL", OUT, "centre", round(cx, 3), round(cy, 3), "frame_m", FRAME_M, flush=True)
