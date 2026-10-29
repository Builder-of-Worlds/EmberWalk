import argparse
import json
import os
import platform
import sys
import time

sys.path = [os.path.dirname(os.path.abspath(__file__))] + sys.path

import bpy

from ewscene import blendscene, chunks, house, paths


def main():
    parser = argparse.ArgumentParser(prog="render_frames.py", description="Render the opened house scene's walk as PNG frames in resumable chunks, most hazard frames first.")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--motion", required=True)
    parser.add_argument("--frames", required=True)
    parser.add_argument("--chunk", type=int, default=300)
    parser.add_argument("--only", help="first:last, render only frames in this range")
    parser.add_argument("--test", action="store_true", help="EEVEE test render instead of the final Cycles settings")
    parser.add_argument("--percent", type=int, default=100, help="resolution percent, test renders only")
    args = parser.parse_args(paths.script_args())
    spec, motion = house.load_json(args.spec), house.load_json(args.motion)
    scene = bpy.context.scene
    if args.percent != 100 and not args.test:
        print("EW_ERROR --percent is for test renders only", file=sys.stderr)
        sys.exit(2)
    scene.render.resolution_percentage = args.percent
    settings = {"engine": scene.render.engine} if args.test else blendscene.final_settings()
    folder = os.path.abspath(args.frames)
    os.makedirs(folder, exist_ok=True)
    plan = chunks.plan(motion["frame_count"], chunks.hazard_frames(spec, motion), args.chunk)
    first, last = (int(x) for x in args.only.split(":")) if args.only else (1, motion["frame_count"])
    with open(os.path.join(folder, "chunks.json"), "w", encoding="utf-8") as f:
        json.dump({"scene": spec["id"], "frame_count": motion["frame_count"], "chunks": plan, "settings": settings,
                   "blender": bpy.app.version_string, "machine": platform.platform()}, f, indent=2)
    scene.render.image_settings.media_type = "IMAGE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.use_file_extension = False
    for c in plan:
        for frame in chunks.todo(c, folder):
            if not first <= frame <= last:
                continue
            final = os.path.join(folder, chunks.frame_name(frame))
            scene.frame_set(frame)
            scene.render.filepath = final + ".part"
            started = time.monotonic()
            bpy.ops.render.render(write_still=True)
            os.replace(final + ".part", final)
            print("EW_FRAME %d %.1f s" % (frame, time.monotonic() - started), flush=True)
    print("EW_FRAMES done %s" % folder, flush=True)


main()
