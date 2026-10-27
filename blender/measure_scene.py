import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from ewscene import blendscene, paths
from ewscene.units import m_to_in


def inches(values):
    return [round(m_to_in(v), 3) for v in values]


def material_record(mat):
    nodes = mat.node_tree.nodes
    return {
        "images": {n.image.name: n.image.colorspace_settings.name for n in nodes if n.type == "TEX_IMAGE"},
        "tints": [[round(v, 3) for v in n.inputs[7].default_value[:3]] for n in nodes if n.type == "MIX"],
    }


def main():
    parser = argparse.ArgumentParser(prog="measure_scene.py", description="Measure an opened scene from its geometry.")
    parser.add_argument("--out", required=True)
    parser.add_argument("--every", type=int, default=10)
    args = parser.parse_args(paths.script_args())
    scene = bpy.context.scene
    wall = bpy.data.objects["House wall"]
    groups = {}
    for o in bpy.data.objects:
        if o.type == "MESH" and o.get(blendscene.HAZARD_TAG):
            groups.setdefault(o[blendscene.HAZARD_TAG], []).append(o)
    hazards = {}
    for hazard_id, objs in sorted(groups.items()):
        lo, hi = blendscene.world_bounds(objs)
        hazards[hazard_id] = {"min": inches(lo), "max": inches(hi)}
    frames = list(range(scene.frame_start, scene.frame_end + 1, args.every))
    if frames[-1] != scene.frame_end:
        frames.append(scene.frame_end)
    poses = []
    for f in frames:
        scene.frame_set(f)
        mw = scene.camera.matrix_world
        poses.append({
            "frame": f,
            "pos_in": inches(mw.translation),
            "rotation": [[round(mw[i][j], 6) for j in range(3)] for i in range(3)],
        })
    cam = scene.camera.data
    r = scene.render
    record = {
        "objects": sorted("%s:%s" % (o.type, o.name) for o in bpy.data.objects),
        "hazard_materials": {i: sorted({m.name for o in objs for m in o.data.materials}) for i, objs in sorted(groups.items())},
        "materials": {m.name: material_record(m) for m in bpy.data.materials if m.node_tree},
        "wall_face_y_in": inches(blendscene.world_bounds([wall])[1])[1],
        "hazards": hazards,
        "camera": poses,
        "render": {
            "width_px": r.resolution_x * r.resolution_percentage // 100,
            "height_px": r.resolution_y * r.resolution_percentage // 100,
            "fps": r.fps / r.fps_base,
            "frame_count": scene.frame_end - scene.frame_start + 1,
            "focal_mm": cam.lens,
            "sensor_width_mm": cam.sensor_width,
            "sensor_fit": cam.sensor_fit,
            "codec": r.ffmpeg.codec,
            "container": r.ffmpeg.format,
            "label": scene.get("ew_label"),
        },
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)


main()
