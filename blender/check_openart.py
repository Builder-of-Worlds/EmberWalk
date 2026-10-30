import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import openart


def main(argv):
    parser = argparse.ArgumentParser(prog="check_openart.py", description="Check the OpenArt look file or the mix list of a synthetic sample house and print its credit total.")
    parser.add_argument("--look", help="look.json: every OpenArt still, its credits and the owner's picks")
    parser.add_argument("--mix", help="mix.json: the walk cut into chunks, Blender or OpenArt, with each clip's credits and SAM check")
    parser.add_argument("--truth", help="truth.json of the walk, read with --mix")
    args = parser.parse_args(argv)
    if not args.look and not args.mix:
        parser.error("give --look, --mix or both")
    try:
        if args.mix and not args.truth:
            raise openart.OpenArtError("invalid", "--mix needs --truth")
        look = openart.validate_look(openart.load_json(args.look)) if args.look else None
        mix = openart.validate_mix(openart.load_json(args.mix), openart.load_json(args.truth)) if args.mix else None
    except openart.OpenArtError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 3
    if look:
        print(openart.look_summary(look))
    if mix:
        print(openart.mix_summary(mix))
    if look and mix:
        spent, _ = openart.mix_totals(mix)
        made = openart.credit_sum(s["credits"] for s in look["stills"])
        print("total %s credits (look %s, mix %s)" % (openart.fmt(openart.credit_sum([made, spent])), openart.fmt(made), openart.fmt(spent)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
