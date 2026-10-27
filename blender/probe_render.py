import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import paths, probe, truth


def main(argv):
    parser = argparse.ArgumentParser(prog="probe_render.py", description="Check a rendered walk and write its render.json.")
    parser.add_argument("scene")
    parser.add_argument("--renders", default=paths.renders_dir())
    parser.add_argument("--motion", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    rel = "%s/walk.mp4" % args.scene
    video = os.path.join(args.renders, rel)
    with open(video + ".settings.json", encoding="utf-8") as f:
        settings = json.load(f)
    with open(args.motion, encoding="utf-8") as f:
        motion = json.load(f)
    rec = probe.record(args.scene, rel, probe.ffprobe(video), os.path.getsize(video), probe.sha256(video), settings)
    found = probe.problems(rec, motion)
    if found:
        print("EW_ERROR %s: %s" % (rel, "; ".join(found)), file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(truth.dumps(rec))
    print("EW_PROBED %s %dx%d %s %d frames %.3f s" % (rel, rec["width"], rec["height"], rec["codec"], rec["frame_count"], rec["duration_s"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
