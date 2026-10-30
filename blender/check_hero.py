import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import herocheck, house


def main(argv):
    parser = argparse.ArgumentParser(prog="check_hero.py", description="Check the hero-before and hero-after truth, motion, parts and render files. Exit 0 clean, 1 a problem, 2 a missing file.")
    parser.add_argument("--fixtures", default=os.path.join(house.REPO,"fixtures", "synthetic"))
    args = parser.parse_args(argv)
    missing, problems, clean = herocheck.check(os.path.abspath(args.fixtures))
    for key in missing:
        print("EW_MISSING %s" % key, file=sys.stderr)
    for where, text in problems:
        print("EW_PROBLEM %s: %s" % (where, text), file=sys.stderr)
    for scene in clean:
        print("EW_OK %s" % scene)
    if missing:
        return 2
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
