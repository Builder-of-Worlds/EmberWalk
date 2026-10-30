import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

import support
from ewscene import assemble, chunks, probe, schema

ASSEMBLE = os.path.join(support.BLENDER_DIR, "assemble_walk.py")
PROBE = os.path.join(support.BLENDER_DIR, "probe_render.py")
FRAMES = 6
SIZE = (64, 36)


def png(width, height, grey):
    row = b"\x00" + bytes([grey]) * (width * 3)
    raw = b"".join([row] * height)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def write(path, data, mode="wb"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode) as f:
        f.write(data)


def chunks_doc(count=FRAMES):
    return {"scene": "hero-before", "frame_count": count, "blender": "5.2.2 LTS", "machine": "macOS-arm64",
            "settings": {"engine": "CYCLES", "samples": 64, "denoiser": "OPENIMAGEDENOISE", "resolution": [64, 36, 100]},
            "chunks": [{"start_frame": 4, "end_frame": 6, "hazard_frames": 3}, {"start_frame": 1, "end_frame": 3, "hazard_frames": 0}]}


def log_text(frames, seconds):
    return "".join("EW_FRAME %d %.1f s\n" % (f, seconds) for f in frames) + "EW_FRAMES done x\n"


def motion_doc(count=FRAMES, fps=15):
    return {"scene": "hero-before", "frame_count": count, "fps": fps, "duration_s": count / fps,
            "camera": {"width_px": SIZE[0], "height_px": SIZE[1]}}


def frames_folder(root, count=FRAMES):
    folder = os.path.join(root, "hero-before", "frames")
    for f in range(1, count + 1):
        write(os.path.join(folder, chunks.frame_name(f)), png(SIZE[0], SIZE[1], f * 10))
    write(os.path.join(folder, "chunks.json"), json.dumps(chunks_doc(count)), "w")
    return folder


class Pure(unittest.TestCase):
    def test_a_complete_folder_has_nothing_missing(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(assemble.missing(frames_folder(root), FRAMES), [])

    def test_missing_frames_are_listed(self):
        with tempfile.TemporaryDirectory() as root:
            folder = frames_folder(root)
            os.remove(os.path.join(folder, chunks.frame_name(2)))
            write(os.path.join(folder, chunks.frame_name(4)), b"")
            self.assertEqual(assemble.missing(folder, FRAMES), [2, 4])

    def test_a_part_file_is_not_a_frame(self):
        with tempfile.TemporaryDirectory() as root:
            folder = frames_folder(root)
            os.replace(os.path.join(folder, chunks.frame_name(3)), os.path.join(folder, chunks.frame_name(3) + ".part"))
            self.assertEqual(assemble.missing(folder, FRAMES), [3])

    def test_seconds_add_up_each_frame_once_and_the_last_line_wins(self):
        self.assertEqual(assemble.seconds([log_text([1, 2, 3], 2.0), log_text([3], 5.0)]), 9.0)

    def test_a_log_with_no_frame_line_has_no_seconds(self):
        self.assertEqual(assemble.seconds(["EW_FRAMES done x\nnoise\n"]), 0.0)

    def test_settings_have_the_shape_render_walk_writes(self):
        got = assemble.settings(chunks_doc(), [log_text(range(1, FRAMES + 1), 2.0)])
        self.assertEqual(got, {"engine": "CYCLES", "samples": 64, "render_seconds": 12.0, "blender": "5.2.2 LTS", "machine": "macOS-arm64",
                               "chunk_order": [[4, 6], [1, 3]]})

    def test_a_chunk_file_without_its_chunks_is_refused(self):
        doc = chunks_doc()
        del doc["chunks"]
        with self.assertRaises(assemble.AssembleError) as e:
            assemble.settings(doc, [""])
        self.assertEqual(e.exception.kind, "invalid")

    def test_a_chunk_file_without_settings_is_refused(self):
        doc = chunks_doc()
        del doc["settings"]
        with self.assertRaises(assemble.AssembleError) as e:
            assemble.settings(doc, [""])
        self.assertEqual(e.exception.kind, "invalid")

    def test_frames_beyond_the_walk_are_not_counted(self):
        self.assertEqual(assemble.seconds([log_text([1, 2, 99], 1.0)], FRAMES), 2.0)


class Cli(unittest.TestCase):
    def assemble(self, root, *extra, count=FRAMES):
        folder = os.path.join(root, "hero-before", "frames")
        write(os.path.join(root, "motion.json"), json.dumps(motion_doc(count)), "w")
        write(os.path.join(root, "render.log"), log_text(range(1, count + 1), 2.0), "w")
        return subprocess.run([sys.executable, ASSEMBLE, "--frames", folder, "--motion", os.path.join(root, "motion.json"),
                               "--log", os.path.join(root, "render.log"), "--out", os.path.join(root, "hero-before", "walk.mp4")] + list(extra),
                              capture_output=True, text=True)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is not installed")
    def test_the_frames_become_a_walk_that_probe_render_accepts(self):
        with tempfile.TemporaryDirectory() as root:
            frames_folder(root)
            r = self.assemble(root)
            self.assertEqual(r.returncode, 0, r.stderr)
            video = os.path.join(root, "hero-before", "walk.mp4")
            self.assertTrue(os.path.getsize(video) > 0)
            self.assertEqual(support.load_json(video + ".settings.json")["render_seconds"], 12.0)
            out = os.path.join(root, "render.json")
            p = subprocess.run([sys.executable, PROBE, "hero-before", "--renders", root, "--motion", os.path.join(root, "motion.json"), "--out", out],
                               capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            rec = support.load_json(out)
            self.assertEqual((rec["file"], rec["frame_count"], rec["fps"], rec["codec"]), ("hero-before/walk.mp4", FRAMES, 15.0, "h264"))
            self.assertEqual(rec["sha256"], probe.sha256(video))
            self.assertEqual(rec["settings"]["chunk_order"], [[4, 6], [1, 3]])
            self.assertEqual(schema.errors(rec, schema.load("render")), [])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is not installed")
    def test_a_missing_frame_exits_3_and_writes_no_video(self):
        with tempfile.TemporaryDirectory() as root:
            folder = frames_folder(root)
            os.remove(os.path.join(folder, chunks.frame_name(5)))
            r = self.assemble(root)
            self.assertEqual(r.returncode, 3)
            self.assertIn("5", r.stderr)
            self.assertFalse(os.path.exists(os.path.join(root, "hero-before", "walk.mp4")))

    def test_a_chunk_file_for_another_frame_count_exits_3(self):
        with tempfile.TemporaryDirectory() as root:
            frames_folder(root)
            r = self.assemble(root, count=FRAMES + 1)
            self.assertEqual(r.returncode, 3)
            self.assertIn("frame_count", r.stderr)


if __name__ == "__main__":
    unittest.main()
