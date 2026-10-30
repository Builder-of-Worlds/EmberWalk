import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

from ewscene import assets, blendscene, house, paths, route, truth


def checked(spec_path, changes_path, catalog):
    doc = house.load_json(spec_path)
    rules = house.load_rules()
    house.validate(doc, catalog, rules)
    if changes_path:
        doc = house.after_spec(doc, house.load_json(changes_path), catalog, rules)
    house.roof_prisms(doc)
    motion_doc, parts_doc = route.build(doc)
    return doc, motion_doc, parts_doc


def main():
    parser = argparse.ArgumentParser(prog="build_house.py", description="Build a hero house spec into a Blender scene.")
    parser.add_argument("spec")
    parser.add_argument("--changes", help="changes.json: build the after scene these changes make")
    parser.add_argument("--out")
    args = parser.parse_args(paths.script_args())
    started = time.monotonic()
    catalog = assets.load_catalog()
    try:
        doc, motion_doc, parts_doc = checked(args.spec, args.changes, catalog)
    except house.HouseError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        sys.exit(3)
    out = args.out or os.path.join(paths.renders_dir(), doc["id"])
    os.makedirs(out, exist_ok=True)
    for name, body in (("motion.json", motion_doc), ("parts.json", parts_doc)):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(truth.dumps(body))
    used = house.used_assets(doc, catalog)
    manifests = {
        u["id"]: assets.ensure(u["id"], catalog[u["id"]], assets.cache_dir())
        for u in used if u["kind"] != "scripted"
    }
    findings = [f["id"] for f in house.wood_findings(doc, house.load_rules())]
    blendscene.build_house(doc, catalog, manifests, motion_doc, findings=findings)
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
    if doc.get("trees"):
        record["trees"] = blendscene.tree_record(doc)
    with open(os.path.join(out, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    print("EW_BUILT %s in %.1f s" % (blend, record["build_seconds"]))


main()
