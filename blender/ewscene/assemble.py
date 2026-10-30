import os
import re

from . import chunks

FRAME_LINE = re.compile(r"^EW_FRAME (\d+) ([0-9.]+) s$")


class AssembleError(Exception):
    def __init__(self, kind, message):
        super().__init__("assemble %s: %s" % (kind, message))
        self.kind = kind


def missing(folder, frame_count):
    out = []
    for f in range(1, frame_count + 1):
        path = os.path.join(folder, chunks.frame_name(f))
        if not (os.path.isfile(path) and os.path.getsize(path) > 0):
            out.append(f)
    return out


def seconds(logs, frame_count=None):
    each = {}
    for text in logs:
        for line in text.splitlines():
            m = FRAME_LINE.match(line.strip())
            if m and (frame_count is None or 1 <= int(m.group(1)) <= frame_count):
                each[int(m.group(1))] = float(m.group(2))
    return round(sum(each.values()), 1)


def settings(doc, logs):
    for key in ("settings", "blender", "machine", "frame_count", "chunks"):
        if key not in doc:
            raise AssembleError("invalid", "chunks.json has no %s" % key)
    for key in ("engine", "samples"):
        if key not in doc["settings"]:
            raise AssembleError("invalid", "chunks.json settings has no %s" % key)
    return {"engine": doc["settings"]["engine"], "samples": doc["settings"]["samples"],
            "render_seconds": seconds(logs, doc["frame_count"]), "blender": doc["blender"], "machine": doc["machine"],
            "chunk_order": [[c["start_frame"], c["end_frame"]] for c in doc["chunks"]]}


def ffmpeg_command(folder, fps, out):
    return ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(folder, "synthetic-frame-%05d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-f", "mp4", out]
