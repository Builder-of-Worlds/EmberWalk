import argparse
import json
import os
import sys

sys.path = [os.path.dirname(os.path.abspath(__file__))] + sys.path

import bpy
import numpy
from mathutils import Vector

from ewscene import chunks, house, paths, stills


def labeller(spec):
    kinds = {s["id"]: s["kind"] for s in spec["structures"]}

    def label(obj, up):
        if obj is None:
            return "sky" if up > 0 else None
        if kinds.get(obj.name) == "driveway":
            return "driveway"
        if obj.name.startswith("Window ") and obj.name.endswith(" glass"):
            return "glass"
        return None
    return label


def rays(scene, step):
    cam = scene.camera
    corners = cam.data.view_frame(scene=scene)
    xs, ys, depth = [c.x for c in corners], [c.y for c in corners], corners[0].z
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w = scene.render.resolution_x * scene.render.resolution_percentage // 100
    h = scene.render.resolution_y * scene.render.resolution_percentage // 100
    turn, origin = cam.matrix_world.to_3x3(), cam.matrix_world.translation
    for row in range(h)[::step]:
        for col in range(w)[::step]:
            local = Vector((x0 + (col + 0.5) / w * (x1 - x0), y0 + (row + 0.5) / h * (y1 - y0), depth))
            yield row, col, origin, (turn @ local).normalized()


def frame_grid(scene, image, label, step):
    w, h = image.size
    if (w, h) != (scene.render.resolution_x * scene.render.resolution_percentage // 100,
                  scene.render.resolution_y * scene.render.resolution_percentage // 100):
        raise stills.StillError("%s is %d by %d, the scene renders %d by %d" % (image.name, w, h, scene.render.resolution_x, scene.render.resolution_y))
    px = numpy.empty(w * h * image.channels, dtype=numpy.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, image.channels)
    graph = bpy.context.evaluated_depsgraph_get()
    grid, last = [], None
    for row, col, origin, direction in rays(scene, step):
        if row != last:
            grid.append([])
            last = row
        hit, _, _, _, obj, _ = scene.ray_cast(graph, origin, direction)
        region = label(obj if hit else None, direction.z)
        grid[-1].append((region, [float(v) for v in px[row, col, :3]]) if region else None)
    return grid


def main():
    parser = argparse.ArgumentParser(prog="check_stills.py", description="Check rendered stills of the opened house scene: driveway and sky not flat white, window glass not black.")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--frames", required=True)
    parser.add_argument("--frame", type=int, action="append", required=True)
    parser.add_argument("--step", type=int, default=8)
    args = parser.parse_args(paths.script_args())
    scene, label = bpy.context.scene, labeller(house.load_json(args.spec))
    bad = 0
    for frame in args.frame:
        path = os.path.join(os.path.abspath(args.frames), chunks.frame_name(frame))
        if not os.path.isfile(path):
            print("EW_ERROR no still %s" % path, file=sys.stderr)
            sys.exit(2)
        scene.frame_set(frame)
        image = bpy.data.images.load(path)
        try:
            stats = stills.region_stats(frame_grid(scene, image, label, args.step))
        except stills.StillError as e:
            print("EW_ERROR %s" % e, file=sys.stderr)
            sys.exit(2)
        found = stills.faults(stats)
        bad += len(found)
        print("EW_STILL %s" % json.dumps({"frame": frame, "regions": stats, "faults": found}, sort_keys=True))
    sys.exit(3 if bad else 0)


main()
