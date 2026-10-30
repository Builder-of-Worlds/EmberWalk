LABEL = "ew_label"


class OutputError(Exception):
    pass


def choices(struct, prop):
    return [item.identifier for item in struct.bl_rna.properties[prop].enum_items]


def pick(struct, prop, wanted):
    found = choices(struct, prop)
    if wanted not in found:
        raise OutputError("this Blender offers no %s for %s (it offers %s); the walk needs a Blender build with FFmpeg" % (wanted, prop, ", ".join(found)))
    setattr(struct, prop, wanted)


def video(render):
    im = render.image_settings
    if "media_type" in im.bl_rna.properties:
        pick(im, "media_type", "VIDEO")
    pick(im, "file_format", "FFMPEG")
    pick(render.ffmpeg, "format", "MPEG4")
    pick(render.ffmpeg, "codec", "H264")


def png(render):
    im = render.image_settings
    if "media_type" in im.bl_rna.properties:
        pick(im, "media_type", "IMAGE")
    pick(im, "file_format", "PNG")


def built(scene, blend_path):
    if not blend_path or LABEL not in scene:
        raise OutputError("no built scene is open, so Blender would render its startup scene; name the scene.blend before --python")
