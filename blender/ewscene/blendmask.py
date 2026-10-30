import bpy
import numpy

from . import blendscene, maskbox, output


def flat_colours(scene):
    ids = sorted({o[blendscene.HAZARD_TAG] for o in bpy.data.objects if o.get(blendscene.HAZARD_TAG)})
    indices = maskbox.assign(ids)
    for o in bpy.data.objects:
        hazard_id = o.get(blendscene.HAZARD_TAG)
        v = maskbox.level_to_linear(indices[hazard_id]) if hazard_id else 0.0
        o.color = (v, v, v, 1.0)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "OBJECT"
    shading.show_object_outline = False
    scene.display.render_aa = "OFF"
    scene.render.dither_intensity = 0.0
    scene.world.color = (0.0, 0.0, 0.0)
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    output.png(scene.render)
    im = scene.render.image_settings
    im.color_mode = "RGB"
    im.color_depth = "8"
    return indices


def classes(path, width, height):
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    px = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(px)
    bpy.data.images.remove(image)
    grey = numpy.rint(px[0::4] * 255.0).astype(numpy.int32)
    index = maskbox.index_of(grey).astype(numpy.uint8)
    return index.reshape(height, width)[::-1].tobytes()
