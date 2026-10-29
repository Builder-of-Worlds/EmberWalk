import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import support
from ewscene import probe, schema

FFPROBE = {
    "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
         "r_frame_rate": "30/1", "avg_frame_rate": "30/1", "nb_read_frames": "600", "duration": "20.000000"},
    ],
    "format": {"duration": "20.000000", "size": "12345"},
}
SETTINGS = {"engine": "BLENDER_EEVEE", "samples": 16, "render_seconds": 400.0, "blender": "5.2.2 LTS", "machine": "macOS-arm64"}
MOTION = {"fps": 30, "frame_count": 600, "duration_s": 20, "camera": {"width_px": 1920, "height_px": 1080}}


class Record(unittest.TestCase):
    def build(self, ff=FFPROBE):
        return probe.record("test-yard", "test-yard/walk.mp4", ff, 12345, "a" * 64, SETTINGS)

    def test_record_from_ffprobe(self):
        rec = self.build()
        self.assertEqual((rec["width"], rec["height"], rec["codec"]), (1920, 1080, "h264"))
        self.assertEqual((rec["fps"], rec["frame_count"], rec["duration_s"]), (30.0, 600, 20.0))
        self.assertEqual(schema.errors(rec, schema.load("render")), [])

    def test_the_record_carries_the_running_version_and_machine(self):
        for blender, machine, engine in (("4.5.15 LTS", "macOS-15.7-x86_64-i386-64bit", "BLENDER_EEVEE_NEXT"),
                                         ("5.2.2 LTS", "macOS-26.6.2-arm64-arm-64bit-Mach-O", "CYCLES")):
            with self.subTest(blender=blender):
                settings = dict(SETTINGS, blender=blender, machine=machine, engine=engine)
                rec = probe.record("test-yard", "test-yard/walk.mp4", FFPROBE, 12345, "a" * 64, settings)
                self.assertEqual((rec["settings"]["blender"], rec["settings"]["machine"]), (blender, machine))
                self.assertEqual(schema.errors(rec, schema.load("render")), [])
                self.assertEqual(probe.problems(rec, MOTION), [])

    def test_good_render_has_no_problems(self):
        self.assertEqual(probe.problems(self.build(), MOTION), [])

    def test_each_mismatch_is_reported(self):
        cases = [
            ("width", 1280, "1280x1080"),
            ("codec", "hevc", "hevc"),
            ("frame_count", 599, "599 frames"),
            ("duration_s", 19.5, "19.5 s"),
            ("fps", 25.0, "25.0 fps"),
        ]
        for key, value, words in cases:
            with self.subTest(key=key):
                rec = dict(self.build(), **{key: value})
                self.assertTrue(any(words in p for p in probe.problems(rec, MOTION)), probe.problems(rec, MOTION))

    def test_no_video_stream_is_refused(self):
        with self.assertRaises(ValueError):
            self.build({"streams": [{"codec_type": "audio"}], "format": {}})

    def test_fraction_rates(self):
        self.assertAlmostEqual(probe.rate("30000/1001"), 29.97, places=2)
        self.assertEqual(probe.rate("0/0"), 0.0)

    def test_sha256_of_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"abc")
        try:
            self.assertEqual(probe.sha256(f.name), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        finally:
            os.remove(f.name)


class Cli(unittest.TestCase):
    def test_probe_without_motion_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "render.json")
            script = os.path.join(support.BLENDER_DIR, "probe_render.py")
            r = subprocess.run([sys.executable, script, "test-yard", "--renders", tmp, "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2, r.stderr)
            self.assertIn("required: --motion", r.stderr)
            self.assertFalse(os.path.exists(out))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg not found: the probe round trip did not run, so this is a PARTIAL RUN")
class RoundTrip(unittest.TestCase):
    def test_probe_cli_refuses_a_video_that_does_not_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = os.path.join(tmp, "test-yard", "walk.mp4")
            os.makedirs(os.path.dirname(video))
            r = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30",
                                "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], capture_output=True)
            if r.returncode != 0:
                self.fail("ffmpeg could not make a sample video: %s" % r.stderr[-300:])
            with open(video + ".settings.json", "w") as f:
                json.dump(SETTINGS, f)
            out = os.path.join(tmp, "render.json")
            script = os.path.join(support.BLENDER_DIR, "probe_render.py")
            r = subprocess.run([sys.executable, script, "test-yard", "--renders", tmp,
                                "--motion", os.path.join(support.FIXTURE_DIR, "motion.json"), "--out", out],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, r.stderr)
            self.assertIn("320x240", r.stderr)
            self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main()
