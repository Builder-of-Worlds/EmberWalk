import argparse
import json
import os
import subprocess
import sys
import time

sys.path = [os.path.dirname(os.path.abspath(__file__))] + sys.path

from ewscene import chunks


def run(left, render, limit, say):
    remaining = left()
    while remaining > 0:
        say("EW_CHUNK start %d left, at most %d this process" % (remaining, limit))
        code = render(limit)
        now = left()
        say("EW_CHUNK exit %d, %d rendered, %d left" % (code, remaining - now, now))
        if code != 0:
            return code
        if now >= remaining:
            say("EW_CHUNK stopped: the process rendered no frame")
            return 1
        remaining = now
    say("EW_CHUNK done")
    return 0


def main():
    parser = argparse.ArgumentParser(prog="render_chunks.py", description="Render one walk in chunks, a fresh Blender process per chunk, until every frame is on disk.")
    parser.add_argument("--frames", required=True)
    parser.add_argument("--motion", required=True)
    parser.add_argument("--max-frames", type=int, default=200)
    parser.add_argument("--log", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- then the Blender command line for render_frames.py, without --max-frames")
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("give the Blender command after --")
    with open(args.motion, encoding="utf-8") as f:
        frame_count = json.load(f)["frame_count"]
    folder = os.path.abspath(args.frames)

    with open(args.log, "a", encoding="utf-8") as log:
        def say(line):
            log.write("%s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), line))
            log.flush()

        def render(limit):
            return subprocess.run(command + ["--max-frames", str(limit)], stdout=log, stderr=subprocess.STDOUT).returncode

        sys.exit(run(lambda: chunks.missing(frame_count, folder), render, args.max_frames, say))


if __name__ == "__main__":
    main()
