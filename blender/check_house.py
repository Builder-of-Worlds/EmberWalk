import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import assets, house


def check(path, changes_path):
    doc = house.load_json(path)
    changes = house.load_json(changes_path) if changes_path else None
    rules = house.load_rules()
    catalog = assets.load_catalog()
    house.validate(doc, catalog, rules)
    line = house.summary(doc)
    if changes is not None:
        after = house.after_spec(doc, changes, catalog, rules)
        line += "; " + house.after_summary(doc, after)
    return line


def main(argv):
    parser = argparse.ArgumentParser(prog="check_house.py", description="Check a hero house spec or truth, and optionally the after scene its changes make.")
    parser.add_argument("file", help="house spec or house truth json")
    parser.add_argument("--changes", help="changes.json: the after scene, checked against this before spec")
    args = parser.parse_args(argv)
    try:
        line = check(args.file, args.changes)
    except house.HouseError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 3
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
