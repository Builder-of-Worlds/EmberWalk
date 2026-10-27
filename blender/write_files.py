import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import assets, motion, truth
from ewscene import spec as scene_spec


def write(doc, out):
    walk = motion.build(doc)
    files = {"motion.json": walk, "truth.json": truth.build(doc, walk)}
    os.makedirs(out, exist_ok=True)
    for name, body in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(truth.dumps(body))
    return files


def main(argv):
    parser = argparse.ArgumentParser(prog="write_files.py", description="Write truth.json and motion.json for a scene spec.")
    parser.add_argument("spec")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        doc = scene_spec.load(args.spec, assets.load_catalog())
    except scene_spec.SpecError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 2
    write(doc, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
