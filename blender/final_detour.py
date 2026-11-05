# blender --background --factory-startup --python-exit-code 1 --python blender/final_detour.py -- <code dir> build <motion.json> <out motion-detour.json>
#   ... -- <code dir> truth <truth.json> <mask pass.json> <motion-detour.json> <out truth.json>
# build writes the walk with ewscene/detour.py applied and refuses a heading that turns too fast; truth replaces the boxes of the frames in the mask pass.
import json
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
CODE, MODE = argv[:2]
sys.path.insert(0, os.path.join(CODE, "blender"))

from ewscene import detour, route, truth


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        f.write(truth.dumps(doc))


if MODE == "build":
    walk = load(argv[2])
    after = dict(walk, samples=detour.apply(walk["samples"]))
    route.check_steady_turns(after["samples"])
    moved = detour.changed(walk["samples"], after["samples"])
    save(argv[3], after)
    print("EW_DETOUR changed", len(moved), "first", moved[0], "last", moved[-1], "top speed before", round(detour.top_speed_m_s(walk["samples"], walk["fps"]), 2), "after", round(detour.top_speed_m_s(after["samples"], walk["fps"]), 2), flush=True)
elif MODE == "truth":
    before, mask_pass, walk = load(argv[2]), load(argv[3]), load(argv[4])
    after = detour.merge_truth(before, mask_pass, walk["samples"])
    first, last = mask_pass["frames"][0]["frame"], mask_pass["frames"][-1]["frame"]
    for a, b in zip(before["hazards"], after["hazards"]):
        if "frame_boxes" in a:
            inside = lambda doc: [r for r in doc["frame_boxes"] if first <= r["frame"] <= last]
            print("EW_HAZARD", a["id"], "frames in the redone range", len(inside(a)), "->", len(inside(b)), "total", a["visible_frames"], "->", b["visible_frames"], flush=True)
    save(argv[5], after)
else:
    raise SystemExit("EW_ERROR mode is build or truth")
