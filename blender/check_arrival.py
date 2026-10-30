import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import arrival, paths


def main(argv):
    parser = argparse.ArgumentParser(prog="check_arrival.py", description="Check files moved between machines against the size and sha256 in render.json, look.json or recheck.json.")
    parser.add_argument("manifest")
    parser.add_argument("--renders", default=paths.renders_dir())
    args = parser.parse_args(argv)
    try:
        try:
            with open(args.manifest, encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, ValueError) as e:
            raise arrival.ArrivalError("invalid", "%s: %s" % (args.manifest, e))
        found = arrival.entries(doc)
        bad = arrival.problems(found, args.renders)
    except arrival.ArrivalError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 3
    if bad:
        print("EW_ERROR arrival refused: %s" % "; ".join(bad), file=sys.stderr)
        return 3
    print("%s: %d file%s match the record" % (os.path.basename(args.manifest), len(found), "" if len(found) == 1 else "s"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
