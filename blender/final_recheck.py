# blender --background --factory-startup --python-exit-code 1 final/after.blend --python blender/final_recheck.py -- <code dir> <spec> <changes> <before truth> <before motion> <out dir> [<after scene name> [<only hazard id>]]
# Renders the Required Now recheck stills of the after scene in the final look, 1920x1080, 64 samples, from the before walk's proof frame poses.
# The camera is level (heading only) with the sample's own shift_y, as look_chunk poses it. The mask pass is 1280x720, the size of the before walk's mask pass.
# A still already in the out dir is kept, so a rerun resumes. With an only hazard id: one still and one printed mask result, no recheck.json.
import hashlib
import json
import os
import sys
import tempfile

argv = sys.argv[sys.argv.index("--") + 1:]
CODE, SPEC, CHANGES, TRUTH, MOTION, OUT = argv[:6]
NAME = argv[6] if len(argv) > 6 else "hero-after-steady"
ONLY = argv[7] if len(argv) > 7 else None
sys.path.insert(0, os.path.join(CODE, "blender"))

import bpy
from mathutils import Matrix

from ewscene import assets, blendmask, blendscene, deckboards, finalshots, geom, house, maskbox, output, paths, recheck

paths.relink(bpy.data)

STILL_W, STILL_H = 1920, 1080
MASK_W, MASK_H = 1280, 720


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


catalog, rules = assets.load_catalog(), house.load_rules()
spec = house.load_json(SPEC)
house.validate(spec, catalog, rules)
after = house.after_spec(spec, house.load_json(CHANGES), catalog, rules)
after["id"] = NAME
before, walk = house.load_json(TRUTH), house.load_json(MOTION)
missing = [h["id"] for h in before["hazards"] if h["label"] == "required_now" and not h.get("frame_boxes")]
if missing:
    raise SystemExit("EW_ERROR the before truth has no frame_boxes for %s; attach the mask pass first" % missing)
scene = bpy.context.scene
gone = [im.filepath for im in bpy.data.images if im.source == "FILE" and not os.path.isfile(bpy.path.abspath(im.filepath))]
if gone:
    raise SystemExit("EW_ERROR %d textures missing, first %s" % (len(gone), gone[0]))
deckboards.swap_deck()
cam = bpy.data.objects["Phone"]
cam.animation_data_clear()
cam.rotation_mode = "QUATERNION"
cam.data.lens = walk["camera"]["focal_mm"]
scene.camera = cam
scene.frame_set(1)
scene.render.resolution_percentage = 100


def pose(entry):
    p = finalshots.still_pose(finalshots.sample_at(walk, entry["before_frame"]), walk["camera"])
    cam.location = p["location_m"]
    cam.rotation_quaternion = Matrix(geom.camera_rotation(p["heading_deg"], 0.0, 0.0)).to_quaternion()
    cam.data.shift_y = p["shift_y"]
    bpy.context.view_layer.update()


plan = recheck.plan(before, walk)
if ONLY:
    plan = [e for e in plan if e["hazard_id"] == ONLY]
    if not plan:
        raise SystemExit("EW_ERROR %s is not a required_now hazard of the before truth" % ONLY)
os.makedirs(OUT, exist_ok=True)
blendscene.final_settings()
scene.cycles.samples = 64
output.png(scene.render)
scene.render.use_file_extension = False
scene.render.resolution_x, scene.render.resolution_y = STILL_W, STILL_H
results = {}
for entry in plan:
    path = os.path.join(OUT, entry["file"])
    if not (os.path.isfile(path) and os.path.getsize(path) > 0):
        pose(entry)
        scene.render.filepath = path + ".part"
        bpy.ops.render.render(write_still=True)
        os.replace(path + ".part", path)
    results[entry["hazard_id"]] = {"sha256": sha256(path)}
    print("EW_STILL", entry["hazard_id"], entry["before_frame"], flush=True)
scene.render.resolution_x, scene.render.resolution_y = MASK_W, MASK_H
indices = blendmask.flat_colours(scene)
with tempfile.TemporaryDirectory() as tmp:
    mask = os.path.join(tmp, "mask.png")
    for entry in plan:
        pose(entry)
        scene.render.filepath = mask
        bpy.ops.render.render(write_still=True)
        hit = maskbox.boxes(blendmask.classes(mask, MASK_W, MASK_H), MASK_W, MASK_H, indices).get(entry["hazard_id"])
        results[entry["hazard_id"]]["area_px"] = hit["area_px"] if hit else 0
        if hit and recheck.fate(after, entry["hazard_id"]) == "fixed":
            results[entry["hazard_id"]]["box_px"] = hit["box_px"]
        print("EW_MASK", entry["hazard_id"], recheck.fate(after, entry["hazard_id"]), results[entry["hazard_id"]], flush=True)
if ONLY:
    print("EW_RECHECK_TEST", ONLY, flush=True)
    raise SystemExit(0)
doc = recheck.build(before, walk, after, results)
recheck.check(doc, before, walk, after)
with open(os.path.join(OUT, "recheck.json"), "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print("EW_RECHECK", NAME, len(doc["stills"]), "stills", flush=True)
