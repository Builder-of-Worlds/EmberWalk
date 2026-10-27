import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import assets, motion, truth
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


def main(argv):
    parser = argparse.ArgumentParser(prog="write_files.py", description="Write truth.json and motion.json for a scene spec.")
    parser.add_argument("spec")
    parser.add_argument("--out", required=True)
    parser.add_argument("--mask-pass", help="boxes.json from render_masks.py: writes per frame tight boxes into truth.json")
    args = parser.parse_args(argv)
    try:
        doc = scene_spec.load(args.spec, assets.load_catalog())
    except scene_spec.SpecError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 2
    mask_pass = None
    if args.mask_pass:
        with open(args.mask_pass, encoding="utf-8") as f:
            mask_pass = json.load(f)
    try:
        write(doc, args.out, mask_pass)
    except truth.MaskPassError as e:
        print("EW_ERROR mask pass: %s" % e, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
