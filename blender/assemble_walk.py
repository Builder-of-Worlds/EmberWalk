import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ewscene import assemble


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main(argv):
    parser = argparse.ArgumentParser(prog="assemble_walk.py", description="Join the rendered PNG frames of a walk into walk.mp4 and write walk.mp4.settings.json.")
    parser.add_argument("--frames", required=True)
    parser.add_argument("--motion", required=True)
    parser.add_argument("--log", action="append", required=True, help="a render_frames.py output file; repeat for each run")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        try:
            doc, motion = json.loads(read(os.path.join(args.frames, "chunks.json"))), json.loads(read(args.motion))
            logs = [read(p) for p in args.log]
        except (OSError, ValueError) as e:
            raise assemble.AssembleError("invalid", str(e))
        if doc.get("frame_count") != motion["frame_count"]:
            raise assemble.AssembleError("refused", "chunks.json frame_count %s, motion.json %s" % (doc.get("frame_count"), motion["frame_count"]))
        gone = assemble.missing(args.frames, motion["frame_count"])
        if gone:
            raise assemble.AssembleError("refused", "%d frames are missing, first %s" % (len(gone), gone[:10]))
        record = assemble.settings(doc, logs)
    except assemble.AssembleError as e:
        print("EW_ERROR %s" % e, file=sys.stderr)
        return 3
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    part = out + ".part"
    made = subprocess.run(assemble.ffmpeg_command(args.frames, motion["fps"], part), capture_output=True, text=True)
    if made.returncode != 0:
        print("EW_ERROR ffmpeg: %s" % made.stderr[-1500:], file=sys.stderr)
        return 1
    os.replace(part, out)
    with open(out + ".settings.json", "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    print("EW_ASSEMBLED %s %d frames" % (out, motion["frame_count"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
