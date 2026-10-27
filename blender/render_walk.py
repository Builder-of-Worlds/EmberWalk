import argparse
import glob
import json
import os
import platform
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from ewscene import paths


def main():
    parser = argparse.ArgumentParser(prog="render_walk.py", description="Render the opened scene's walk to an H.264 MP4, or one frame to a PNG.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--still", type=int)
    args = parser.parse_args(paths.script_args())
    scene = bpy.context.scene
    scene.eevee.taa_render_samples = args.samples
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    started = time.monotonic()
    if args.still is not None:
        scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        scene.frame_set(args.still)
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print("EW_STILL %s in %.1f s" % (out, time.monotonic() - started))
        return
    prefix = os.path.join(os.path.dirname(out), ".part-")
    for old in glob.glob(prefix + "*"):
        os.remove(old)
    scene.render.filepath = prefix
    bpy.ops.render.render(animation=True)
    made = glob.glob(prefix + "*.mp4")
    if len(made) != 1:
        print("EW_ERROR expected one video, found %s" % made, file=sys.stderr)
        sys.exit(1)
    os.replace(made[0], out)
    settings = {
        "engine": scene.render.engine,
        "samples": args.samples,
        "render_seconds": round(time.monotonic() - started, 1),
        "blender": bpy.app.version_string,
        "machine": platform.platform(),
    }
    with open(out + ".settings.json", "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    print("EW_RENDERED %s in %.1f s" % (out, settings["render_seconds"]))


main()
