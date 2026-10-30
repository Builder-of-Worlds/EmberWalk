import glob
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import support
from ewscene import output, probe

BLENDER = support.blender_path()
WALK = os.path.join(support.BLENDER_DIR, "render_walk.py")
FRAMES = 3
TINY = (
    "import bpy\n"
    "s = bpy.context.scene\n"
    "s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = 64, 48, 100\n"
    "s.frame_start, s.frame_end = 1, %d\n"
    "s.render.image_settings.file_format = 'PNG'\n" % FRAMES
)


class Item:
    def __init__(self, identifier):
        self.identifier = identifier


class Prop:
    def __init__(self, ids):
        self.enum_items = [Item(i) for i in ids]


class Rna:
    def __init__(self, props):
        self.properties = props


class Struct:
    def __init__(self, props, **values):
        self.__dict__["bl_rna"] = Rna({k: Prop(v) for k, v in props.items()})
        self.__dict__["sets"] = []
        self.__dict__.update(values)

    def __setattr__(self, name, value):
        if name not in self.bl_rna.properties:
            raise AttributeError(name)
        self.sets.append(name)
        self.__dict__[name] = value


class Render:
    def __init__(self, media=True, formats=("PNG", "JPEG", "FFMPEG"), containers=("MPEG4", "MKV"), codecs=("NONE", "H264", "H265")):
        props = {"file_format": formats}
        if media:
            props["media_type"] = ("IMAGE", "MULTI_LAYER_IMAGE", "VIDEO")
        self.image_settings = Struct(props, file_format="PNG", **({"media_type": "IMAGE"} if media else {}))
        self.ffmpeg = Struct({"format": containers, "codec": codecs}, format="MKV", codec="NONE")


class Scene(dict):
    pass


class VideoOutput(unittest.TestCase):
    def test_blender_five_gets_video_media_ffmpeg_mpeg4_h264(self):
        r = Render()
        output.video(r)
        self.assertEqual((r.image_settings.media_type, r.image_settings.file_format), ("VIDEO", "FFMPEG"))
        self.assertEqual((r.ffmpeg.format, r.ffmpeg.codec), ("MPEG4", "H264"))
        self.assertEqual(r.image_settings.sets, ["media_type", "file_format"])

    def test_blender_four_without_media_type_still_gets_ffmpeg(self):
        r = Render(media=False)
        output.video(r)
        self.assertEqual(r.image_settings.file_format, "FFMPEG")
        self.assertEqual(r.image_settings.sets, ["file_format"])
        self.assertEqual((r.ffmpeg.format, r.ffmpeg.codec), ("MPEG4", "H264"))

    def test_png_stills_set_media_type_only_where_the_build_has_it(self):
        five = Render()
        output.png(five)
        self.assertEqual((five.image_settings.media_type, five.image_settings.file_format), ("IMAGE", "PNG"))
        self.assertEqual(five.image_settings.sets, ["media_type", "file_format"])
        four = Render(media=False)
        output.png(four)
        self.assertEqual(four.image_settings.sets, ["file_format"])

    def test_png_is_refused_where_the_build_offers_no_png(self):
        r = Render(formats=("JPEG", "FFMPEG"))
        with self.assertRaises(output.OutputError) as caught:
            output.png(r)
        self.assertIn("no PNG for file_format", str(caught.exception))

    def test_blender_without_ffmpeg_is_refused_and_names_what_it_offers(self):
        r = Render(formats=("PNG", "JPEG"))
        with self.assertRaises(output.OutputError) as caught:
            output.video(r)
        self.assertIn("no FFMPEG for file_format", str(caught.exception))
        self.assertIn("PNG, JPEG", str(caught.exception))
        self.assertEqual(r.image_settings.file_format, "PNG")

    def test_missing_container_or_codec_is_refused(self):
        for render, word in ((Render(containers=("MKV",)), "no MPEG4 for format"), (Render(codecs=("H265",)), "no H264 for codec")):
            with self.assertRaises(output.OutputError) as caught:
                output.video(render)
            self.assertIn(word, str(caught.exception))

    def test_choices_reads_identifiers(self):
        self.assertEqual(output.choices(Render().ffmpeg, "codec"), ["NONE", "H264", "H265"])


class BuiltScene(unittest.TestCase):
    def test_saved_scene_with_label_passes(self):
        self.assertIsNone(output.built(Scene(ew_label="Synthetic sample house"), "/r/hero-before/scene.blend"))

    def test_startup_scene_with_no_file_is_refused(self):
        with self.assertRaises(output.OutputError) as caught:
            output.built(Scene(ew_label="x"), "")
        self.assertIn("no built scene is open", str(caught.exception))

    def test_saved_file_without_label_is_refused(self):
        with self.assertRaises(output.OutputError):
            output.built(Scene(), "/r/other.blend")


def blender(args):
    return subprocess.run([BLENDER, "--background", "--factory-startup"] + args, capture_output=True, text=True, timeout=600)


@unittest.skipUnless(BLENDER, "Blender not found: the walk video render test did not run, so this is a PARTIAL RUN")
class WalkRender(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = os.path.join(self.tmp.name, "walk", "walk.mp4")

    def tiny_blend(self, label, extra=""):
        path = os.path.join(self.tmp.name, "scene.blend")
        expr = TINY + extra + ("s['ew_label'] = 'Synthetic sample house'\n" if label else "") + "bpy.ops.wm.save_as_mainfile(filepath=%r)\n" % path
        r = blender(["--python-exit-code", "1", "--python-expr", expr])
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        return path

    def walk(self, before):
        return blender(before + ["--python-exit-code", "1", "--python", WALK, "--", "--out", self.out, "--samples", "1"])

    def test_scene_saved_with_png_output_renders_one_h264_mp4(self):
        r = self.walk([self.tiny_blend(True)])
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertTrue(os.path.isfile(self.out))
        self.assertEqual(glob.glob(os.path.join(os.path.dirname(self.out), ".part-*")), [])
        with open(self.out + ".settings.json", encoding="utf-8") as f:
            self.assertEqual(json.load(f)["samples"], 1)
        if shutil.which("ffprobe"):
            video = [s for s in probe.ffprobe(self.out)["streams"] if s["codec_type"] == "video"][0]
            self.assertEqual((video["codec_name"], int(video["nb_read_frames"])), ("h264", FRAMES))

    def test_no_scene_file_is_refused_before_any_frame(self):
        r = self.walk(["--python-expr", TINY])
        self.assertEqual(r.returncode, 3, r.stderr[-2000:])
        self.assertIn("EW_ERROR no built scene is open", r.stderr)
        self.assertFalse(os.path.exists(os.path.dirname(self.out)))

    def test_scene_without_label_is_refused(self):
        r = self.walk([self.tiny_blend(False)])
        self.assertEqual(r.returncode, 3, r.stderr[-2000:])
        self.assertIn("EW_ERROR no built scene is open", r.stderr)

    def test_still_stays_png_and_leaves_the_video_settings_alone(self):
        out = os.path.join(self.tmp.name, "still.png")
        blend = self.tiny_blend(True, "s.render.ffmpeg.format, s.render.ffmpeg.codec = 'MKV', 'H265'\n")
        after = "import bpy; f = bpy.context.scene.render.ffmpeg; print('EW_TEST_FFMPEG %s %s' % (f.format, f.codec))"
        r = blender([blend, "--python-exit-code", "1", "--python", WALK, "--python-expr", after,
                     "--", "--out", out, "--samples", "1", "--still", "2"])
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        with open(out, "rb") as f:
            self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")
        self.assertIn("EW_TEST_FFMPEG MKV H265", r.stdout)
