import argparse
import json
import os
import sys
import tempfile

sys.path = [os.path.dirname(os.path.dirname(os.path.abspath(__file__)))] + sys.path

import bpy
import numpy
from mathutils import Vector

from ewscene import output, paths

WIDTH, HEIGHT = 96, 54


def sky_mask(scene):
    cam = scene.camera
    corners = cam.data.view_frame(scene=scene)
    xs, ys, depth = [c.x for c in corners], [c.y for c in corners], corners[0].z
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    turn, origin = cam.matrix_world.to_3x3(), cam.matrix_world.translation
    graph = bpy.context.evaluated_depsgraph_get()
    mask = numpy.zeros((HEIGHT, WIDTH), dtype=bool)
    for row in range(HEIGHT):
        for col in range(WIDTH):
            local = Vector((x0 + (col + 0.5) / WIDTH * (x1 - x0), y0 + (row + 0.5) / HEIGHT * (y1 - y0), depth))
            direction = (turn @ local).normalized()
            hit = scene.ray_cast(graph, origin, direction)[0]
            mask[row, col] = (not hit) and direction.z > 0
    padded = numpy.pad(mask, 2, constant_values=False)
    inner = numpy.ones_like(mask)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            inner &= padded[2 + dy:2 + dy + HEIGHT, 2 + dx:2 + dx + WIDTH]
    return inner


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    channels = image.channels
    px = numpy.empty(WIDTH * HEIGHT * channels, dtype=numpy.float32)
    image.pixels.foreach_get(px)
    bpy.data.images.remove(image)
    return px.reshape(HEIGHT, WIDTH, channels)[:, :, :3]


def main():
    parser = argparse.ArgumentParser(prog="probe_sky.py")
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int, action="append", required=True)
    args = parser.parse_args(paths.script_args())
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = WIDTH, HEIGHT, 100
    output.png(scene.render)
    scene.render.use_file_extension = False
    env = next(n for n in scene.world.node_tree.nodes if n.type == "TEX_ENVIRONMENT")
    real = env.image
    magenta = bpy.data.images.new("magenta", 8, 8, float_buffer=True)
    magenta.pixels = [4.0, 0.0, 4.0, 1.0] * 64
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        still = os.path.join(tmp, "still.png")
        for f in args.frame:
            scene.frame_set(f)
            mask = sky_mask(scene)
            env.image = real
            lit = render(scene, still)
            env.image = magenta
            swapped = render(scene, still)
            gap = numpy.abs(lit - swapped).max(axis=2)
            found.append({"frame": f, "sky_pixels": int(mask.sum()), "sky_change": float(gap[mask].max()) if mask.any() else 0.0,
                          "other_change": float(gap[~mask].max()) if (~mask).any() else 0.0})
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(found, fh)


main()
