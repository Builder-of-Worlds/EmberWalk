import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import assets, house, motion, route, truth
from ewscene import spec as scene_spec


def write(doc, out, mask_pass=None):
    walk = motion.build(doc)
    ground_truth = truth.build(doc, walk)
    if mask_pass is not None:
        ground_truth = truth.attach_boxes(ground_truth, mask_pass, walk)
    files = {"motion.json": walk, "truth.json": ground_truth}
    os.makedirs(out, exist_ok=True)
    for name, body in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(truth.dumps(body))
    return files


def write_house(spec_path, out, changes_path=None, mask_pass=None):
    catalog, rules = assets.load_catalog(), house.load_rules()
    doc = house.load_json(spec_path)
    house.validate(doc, catalog, rules)
    fixed = set()
    if changes_path:
        changes = house.load_json(changes_path)
        doc = house.after_spec(doc, changes, catalog, rules)
        fixed = {h["id"] for h in changes["hazards"] if h["change"] == "fixed"}
    house.roof_prisms(doc)
    walk, parts = route.build(doc)
    ground_truth = house.truth_from_spec(doc, rules)
    if mask_pass is not None:
        # the after scene still holds the fixed hazards in their moved places, so its pass names them; the truth does not
        mask_pass = truth.without_ids(mask_pass, ground_truth, fixed)
        ground_truth = truth.attach_boxes(ground_truth, mask_pass, walk)
    files = {"motion.json": walk, "parts.json": parts, "truth.json": ground_truth}
    os.makedirs(out, exist_ok=True)
    for name, body in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(truth.dumps(body))
    return files


def main(argv):
    parser = argparse.ArgumentParser(prog="write_files.py", description="Write truth.json and motion.json for a scene spec.")
    parser.add_argument("spec")
    parser.add_argument("--out", required=True)
    parser.add_argument("--mask-pass", help="boxes.json from render_masks.py: writes per frame tight boxes into truth.json")
    parser.add_argument("--house", action="store_true", help="the spec is a hero house spec: also writes parts.json and the house truth")
    parser.add_argument("--changes", help="with --house: changes.json, writes the after scene's files")
    args = parser.parse_args(argv)
    if args.changes and not args.house:
        print("EW_ERROR --changes needs --house", file=sys.stderr)
        return 2
    mask_pass = None
    if args.mask_pass:
        with open(args.mask_pass, encoding="utf-8") as f:
            mask_pass = json.load(f)
    try:
        if args.house:
            write_house(args.spec, args.out, args.changes, mask_pass)
            return 0
        doc = scene_spec.load(args.spec, assets.load_catalog())
    except (scene_spec.SpecError, house.HouseError) as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 2
    except truth.MaskPassError as e:
        print("EW_ERROR mask pass: %s" % e, file=sys.stderr)
        return 3
    try:
        write(doc, args.out, mask_pass)
    except truth.MaskPassError as e:
        print("EW_ERROR mask pass: %s" % e, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
