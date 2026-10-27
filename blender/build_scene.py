import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import write_files
from ewscene import assets, blendscene, paths
from ewscene import spec as scene_spec


def main():
    parser = argparse.ArgumentParser(prog="build_scene.py")
    parser.add_argument("spec")
    parser.add_argument("--out")
    args = parser.parse_args(paths.script_args())
    started = time.monotonic()
    catalog = assets.load_catalog()
    try:
        doc = scene_spec.load(args.spec, catalog)
    except scene_spec.SpecError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        sys.exit(2)
    out = args.out or os.path.join(paths.renders_dir(), doc["id"])
    os.makedirs(out, exist_ok=True)
    used = assets.used(doc, catalog)
    manifests = {
        u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir())
        for u in used if u["kind"] != "scripted"
    }
    files = write_files.write(doc, out)
    blendscene.build(doc, catalog, manifests, files["motion.json"])
    blend = os.path.join(out, "scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    record = {
        "schema": "emberwalk.scene/1",
        "synthetic": True,
        "label": doc["label"],
        "scene": doc["id"],
        "blend": blend,
        "blender": bpy.app.version_string,
        "assets": [dict(u, resolution=catalog[u["id"]].get("resolution")) for u in used],
        "build_seconds": round(time.monotonic() - started, 1),
    }
    with open(os.path.join(out, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    print("EW_BUILT %s in %.1f s" % (blend, record["build_seconds"]))


main()
