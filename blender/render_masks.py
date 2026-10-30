import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from ewscene import blendmask, maskbox, paths, truth


def main():
    parser = argparse.ArgumentParser(prog="render_masks.py", description="Render a flat colour pass of the opened scene and write the tight box of every hazard per frame.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--every", type=int, default=1)
    args = parser.parse_args(paths.script_args())
    scene = bpy.context.scene
    width, height = scene.render.resolution_x, scene.render.resolution_y
    indices = blendmask.flat_colours(scene)
    frames = list(range(scene.frame_start, scene.frame_end + 1, args.every))
    started = time.monotonic()
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        still = os.path.join(tmp, "mask.png")
        for f in frames:
            scene.frame_set(f)
            scene.render.filepath = still
            bpy.ops.render.render(write_still=True)
            found.append({"frame": f, "boxes": maskbox.boxes(blendmask.classes(still, width, height), width, height, indices)})
    record = {"schema": truth.PASS_SCHEMA, "width": width, "height": height, "indices": indices, "frames": found}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(record, f)
    print("EW_MASKED %s %d frames in %.1f s" % (args.out, len(frames), time.monotonic() - started))


main()
