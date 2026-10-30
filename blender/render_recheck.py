import argparse
import hashlib
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from ewscene import assets, blendmask, blendscene, house, maskbox, output, paths, recheck
from ewscene.units import m_to_in


def load_after(spec_path, changes_path):
    catalog, rules = assets.load_catalog(), house.load_rules()
    before = house.load_json(spec_path)
    house.validate(before, catalog, rules)
    return house.after_spec(before, house.load_json(changes_path), catalog, rules)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def at_pose(scene, entry):
    scene.frame_set(entry["before_frame"])
    world = scene.camera.matrix_world
    problem = recheck.pose_problem([m_to_in(v) for v in world.translation], [list(row) for row in world.to_3x3()], entry)
    if problem:
        raise recheck.RecheckError("refused", problem)


def main():
    parser = argparse.ArgumentParser(prog="render_recheck.py", description="Render the opened after scene from the before walk's proof frame pose of every Required Now hazard.")
    parser.add_argument("--spec", required=True, help="the before house spec")
    parser.add_argument("--changes", required=True)
    parser.add_argument("--truth", required=True, help="the before truth with frame_boxes")
    parser.add_argument("--motion", required=True, help="the before motion")
    parser.add_argument("--out", required=True, help="folder for the stills")
    parser.add_argument("--recheck", required=True, help="where recheck.json is written")
    args = parser.parse_args(paths.script_args())
    started = time.monotonic()
    after = load_after(args.spec, args.changes)
    before, walk = house.load_json(args.truth), house.load_json(args.motion)
    scene = bpy.context.scene
    width, height = scene.render.resolution_x, scene.render.resolution_y
    try:
        plan = recheck.plan(before, walk)
        os.makedirs(args.out, exist_ok=True)
        output.png(scene.render)
        scene.render.use_file_extension = False
        results = {}
        for entry in plan:
            at_pose(scene, entry)
            path = os.path.join(args.out, entry["file"])
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            results[entry["hazard_id"]] = {"sha256": sha256(path)}
        indices = blendmask.flat_colours(scene)
        with tempfile.TemporaryDirectory() as tmp:
            mask = os.path.join(tmp, "mask.png")
            for entry in plan:
                at_pose(scene, entry)
                scene.render.filepath = mask
                bpy.ops.render.render(write_still=True)
                hit = maskbox.boxes(blendmask.classes(mask, width, height), width, height, indices).get(entry["hazard_id"])
                results[entry["hazard_id"]]["area_px"] = hit["area_px"] if hit else 0
                if hit and recheck.fate(after, entry["hazard_id"]) == "fixed":
                    results[entry["hazard_id"]]["box_px"] = hit["box_px"]
        doc = recheck.build(before, walk, after, results)
        recheck.check(doc, before, walk, after)
    except recheck.RecheckError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        sys.exit(3)
    os.makedirs(os.path.dirname(os.path.abspath(args.recheck)), exist_ok=True)
    with open(args.recheck, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("EW_RECHECK %s %d stills in %.1f s" % (args.recheck, len(doc["stills"]), time.monotonic() - started))


main()
