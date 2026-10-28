import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import openart


def main(argv):
    parser = argparse.ArgumentParser(prog="check_openart.py", description="Check the OpenArt look file of a synthetic sample house and print its credit total.")
    parser.add_argument("--look", required=True, help="look.json: every OpenArt still, its credits and Deacon's picks")
    args = parser.parse_args(argv)
    try:
        doc = openart.validate_look(openart.load_json(args.look))
    except openart.OpenArtError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 3
    print(openart.look_summary(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
