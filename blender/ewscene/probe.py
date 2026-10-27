import hashlib
import json
import subprocess


def rate(text):
    num, _, den = text.partition("/")
    den = float(den or 1)
    return round(float(num) / den, 3) if den else 0.0


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ffprobe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def record(scene, rel_file, ff, size, digest, settings):
    video = [s for s in ff.get("streams", []) if s.get("codec_type") == "video"]
    if not video:
        raise ValueError("no video stream")
    v = video[0]
    return {
        "schema": "emberwalk.render/1",
        "synthetic": True,
        "label": "Synthetic sample house",
        "scene": scene,
        "file": rel_file,
        "size_bytes": size,
        "sha256": digest,
        "codec": v["codec_name"],
        "pix_fmt": v.get("pix_fmt", "unknown"),
        "width": v["width"],
        "height": v["height"],
        "fps": rate(v.get("avg_frame_rate") or v["r_frame_rate"]),
        "duration_s": round(float(v.get("duration") or ff["format"]["duration"]), 3),
        "frame_count": int(v.get("nb_read_frames") or v["nb_frames"]),
        "settings": settings,
    }


def problems(rec, motion):
    out = []
    want = (motion["camera"]["width_px"], motion["camera"]["height_px"])
    if (rec["width"], rec["height"]) != want:
        out.append("size %dx%d, expected %dx%d" % (rec["width"], rec["height"], want[0], want[1]))
    if rec["codec"] != "h264":
        out.append("codec %s, expected h264" % rec["codec"])
    if rec["frame_count"] != motion["frame_count"]:
        out.append("%d frames, expected %d" % (rec["frame_count"], motion["frame_count"]))
    if abs(rec["duration_s"] - motion["duration_s"]) > 0.05:
        out.append("%s s long, expected %s s" % (rec["duration_s"], motion["duration_s"]))
    if abs(rec["fps"] - motion["fps"]) > 0.01:
        out.append("%s fps, expected %s" % (rec["fps"], motion["fps"]))
    return out
