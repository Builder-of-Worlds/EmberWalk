import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy

from ewscene import blendscene, maskbox, paths, truth

def flat_colours(scene):
    ids = sorted({o[blendscene.HAZARD_TAG] for o in bpy.data.objects if o.get(blendscene.HAZARD_TAG)})
    indices = {hazard_id: k + 1 for k, hazard_id in enumerate(ids)}
    for o in bpy.data.objects:
        hazard_id = o.get(blendscene.HAZARD_TAG)
        v = maskbox.level_to_linear(indices[hazard_id]) if hazard_id else 0.0
        o.color = (v, v, v, 1.0)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "OBJECT"
    shading.show_object_outline = False
    scene.display.render_aa = "OFF"
    scene.world.color = (0.0, 0.0, 0.0)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    im = scene.render.image_settings
    im.media_type = "IMAGE"
    im.file_format = "PNG"
    im.color_mode = "RGB"
    im.color_depth = "8"
    return indices


def classes(path, width, height):
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    px = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(px)
    bpy.data.images.remove(image)
    grey = numpy.rint(px[0::4] * 255.0).astype(numpy.int32)
    index = maskbox.index_of(grey).astype(numpy.uint8)
    return index.reshape(height, width)[::-1].tobytes()


def main():
    parser = argparse.ArgumentParser(prog="render_masks.py", description="Render a flat colour pass of the opened scene and write the tight box of every hazard per frame.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--every", type=int, default=1)
    args = parser.parse_args(paths.script_args())
    scene = bpy.context.scene
    width, height = scene.render.resolution_x, scene.render.resolution_y
    indices = flat_colours(scene)
    frames = list(range(scene.frame_start, scene.frame_end + 1, args.every))
    started = time.monotonic()
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        still = os.path.join(tmp, "mask.png")
        for f in frames:
            scene.frame_set(f)
            scene.render.filepath = still
            bpy.ops.render.render(write_still=True)
            found.append({"frame": f, "boxes": maskbox.boxes(classes(still, width, height), width, height, indices)})
    record = {"schema": truth.PASS_SCHEMA, "width": width, "height": height, "indices": indices, "frames": found}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(record, f)
    print("EW_MASKED %s %d frames in %.1f s" % (args.out, len(frames), time.monotonic() - started))


main()
