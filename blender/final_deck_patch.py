# blender --background --factory-startup --python-exit-code 1 final/scene.blend --python blender/final_deck_patch.py -- <code dir> <motion.json> masks <out json>
#   ... -- <code dir> <motion.json> render <list json> <out dir> <last old frame> <start> <count>
#       renders one chunk of the listed frames (at or before the last frame the lap drew with the old deck; the phone cut's first two spans first) with the planked deck into a separate dir
#   ... -- <code dir> <motion.json> test <frame> <out png>            one frame
# EW_PORTRAIT=1 does the same for the phone cut (1080x1920, frames inside finalshots.PORTRAIT_SPANS only). The pose and settings are look_chunk.py's, so a patched frame differs from the lap's only where the deck is.
# masks: a flat colour pass at a quarter of the frame size over the frames that could see the deck; the list is every frame where any deck pixel shows.
import json
import math
import os
import sys
import time

argv = sys.argv[sys.argv.index("--") + 1:]
CODE, MOTION, MODE = argv[:3]
sys.path.insert(0, os.path.join(CODE, "blender"))

import bpy
from mathutils import Matrix

from ewscene import blendmask, blendscene, deckboards, finalshots, geom, maskbox, output, paths

paths.relink(bpy.data)

PORTRAIT = bool(os.environ.get("EW_PORTRAIT"))
DECK_BOX = {"min_in": [120, 780, 0], "max_in": [600, 924, 24]}
WATCH = {
    "door": ({"min_in": [120, 770, 0], "max_in": [600, 800, 90]}, None),
    "front-door": ({"min_in": [540, 296, 12], "max_in": [576, 302, 92]}, ((558, 299), (0, -1))),
    "grass": ({"min_in": [150, 1380, 0], "max_in": [450, 1620, 30]}, None),
    "vent": ({"min_in": [716, 440, 0], "max_in": [736, 484, 20]}, None),
    "tank": ({"min_in": [780, 505, 0], "max_in": [822, 566, 32]}, None),
}
HALF_FOV = finalshots.HALF_FOV_PORTRAIT if PORTRAIT else finalshots.HALF_FOV_LANDSCAPE
FULL = (1080, 1920) if PORTRAIT else (1920, 1080)
MASK = (360, 640) if PORTRAIT else (640, 360)

with open(MOTION, encoding="utf-8") as f:
    m = json.load(f)
scene = bpy.context.scene
cam = bpy.data.objects["Phone"]
cam.animation_data_clear()
cam.rotation_mode = "QUATERNION"
cam.data.lens = m["camera"]["focal_mm"]
scene.camera = cam
scene.frame_set(1)
scene.render.resolution_percentage = 100
if PORTRAIT:
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 36.0


def pose(s):
    p = finalshots.still_pose(s, m["camera"])
    cam.location = p["location_m"]
    cam.rotation_quaternion = Matrix(geom.camera_rotation(p["heading_deg"], 0.0, 0.0)).to_quaternion()
    cam.data.shift_y = p["shift_y"]
    bpy.context.view_layer.update()


def candidates():
    frames = finalshots.deck_candidates(m, DECK_BOX, HALF_FOV)
    return [n for n in frames if not PORTRAIT or any(a <= n <= b for a, b in finalshots.PORTRAIT_SPANS)]


if MODE == "masks":
    OUT = argv[3]
    KIND = argv[4] if len(argv) > 4 else "deck"
    DOOR_ONLY = KIND != "deck"
    if DOOR_ONLY:
        seen_already = set()
        if argv[5] != "-":
            with open(argv[5], encoding="utf-8") as f:
                seen_already = set(json.load(f)["frames"])
        last_old = int(argv[6])
        deckboards.swap_deck()
        if KIND == "grass":
            names = ["tall-grass-back"]
        elif KIND == "vent":
            names = list(deckboards.VENT_HEAP) + ["Vent 1"]
        elif KIND == "tank":
            names = ["propane-tank-right"]
        else:
            door = "Front door" if KIND == "front-door" else "Back door"
            names = ["%s%s" % (door, s) for s in ("", " knob", " trim")]
    else:
        names = list(deckboards.DECK_OBJECTS)
    for name in names:
        bpy.data.objects[name][blendscene.HAZARD_TAG] = name
    scene.render.resolution_x, scene.render.resolution_y = MASK
    indices = blendmask.flat_colours(scene)
    found = []
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        still = os.path.join(tmp, "mask.png")
        todo = candidates() if not DOOR_ONLY else [n for n in finalshots.deck_candidates(m, WATCH[KIND][0], HALF_FOV, outward=WATCH[KIND][1]) if n not in seen_already and n <= last_old and (not PORTRAIT or any(a <= n <= b for a, b in finalshots.PORTRAIT_SPANS))]
        for n in todo:
            pose(m["samples"][n - 1])
            scene.render.filepath = still
            bpy.ops.render.render(write_still=True)
            mask_rows = maskbox.rows(blendmask.classes(still, MASK[0], MASK[1]), MASK[0], MASK[1])
            area = sum((maskbox.extent(mask_rows, i) or {"area_px": 0})["area_px"] for i in (indices[n] for n in names))
            found.append({"frame": n, "deck_px": area})
    listed = [r["frame"] for r in found if r["deck_px"] > 0]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"portrait": PORTRAIT, "mask_size": list(MASK), "checked": len(found), "frames": listed, "runs": finalshots.runs(listed), "areas": found}, f)
    print("EW_DECK_LIST", len(found), "checked", len(listed), "show the deck", flush=True)
    raise SystemExit(0)

deckboards.swap_deck()
scene.render.resolution_x, scene.render.resolution_y = FULL
blendscene.final_settings()
scene.cycles.samples = 64
output.png(scene.render)
scene.render.use_file_extension = False


REDO = set()
REDO_BEFORE = float(os.environ.get("EW_REDO_BEFORE", "0"))
if os.environ.get("EW_REDO_LIST"):
    for redo_path in os.environ["EW_REDO_LIST"].split(","):
        with open(redo_path, encoding="utf-8") as f:
            REDO |= set(json.load(f)["frames"])


def draw(n, final):
    if os.path.isfile(final) and os.path.getsize(final) > 0 and not (n in REDO and os.path.getmtime(final) < REDO_BEFORE):
        return
    pose(m["samples"][n - 1])
    scene.render.filepath = final + ".part"
    t = time.monotonic()
    bpy.ops.render.render(write_still=True)
    os.replace(final + ".part", final)
    print("EW_FRAME", n, round(time.monotonic() - t, 2), flush=True)


if MODE == "test":
    os.makedirs(os.path.dirname(os.path.abspath(argv[4])), exist_ok=True)
    draw(int(argv[3]), argv[4])
elif MODE == "render":
    listed = set()
    for entry in argv[3].split(","):
        list_path, _, cap = entry.partition(":")
        with open(list_path, encoding="utf-8") as f:
            listed |= {n for n in json.load(f)["frames"] if n <= int(cap or 10 ** 9)}
    last_old, start, count = int(argv[5]), int(argv[6]), int(argv[7])
    frames = finalshots.chunk(finalshots.patch_order(listed, last_old, finalshots.PORTRAIT_SPANS[:2]), start, count)
    os.makedirs(argv[4], exist_ok=True)
    for n in frames:
        draw(n, os.path.join(argv[4], "frame-%05d.png" % n))
    print("EW_DONE", flush=True)
else:
    raise SystemExit("EW_ERROR mode is masks, render or test")
