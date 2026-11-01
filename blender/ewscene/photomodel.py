import math

import bpy
from mathutils import Matrix, Vector

from .units import in_to_m

_templates = {}
_tinted = set()


def reset():
    _templates.clear()
    _tinted.clear()


def release():
    for objs in _templates.values():
        for o in objs:
            bpy.data.objects.remove(o)
    _templates.clear()


def _load(path, pick):
    key = (path, tuple(pick))
    if key not in _templates:
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            missing = [n for n in pick if n not in src.objects]
            if missing:
                raise ValueError("%s has no object %s" % (path, ", ".join(missing)))
            dst.objects = list(pick)
        _templates[key] = [o for o in dst.objects if o is not None and o.type == "MESH"]
    return _templates[key]


def tint_materials(objs, rgb, only=None):
    for o in objs:
        for mat in o.data.materials:
            if mat is None or mat.name in _tinted or (only and not any(w in mat.name for w in only)):
                continue
            _tinted.add(mat.name)
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            socket = bsdf.inputs["Base Color"]
            mix = mat.node_tree.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            mix.inputs[7].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
            if socket.is_linked:
                mat.node_tree.links.new(socket.links[0].from_socket, mix.inputs[6])
            else:
                mix.inputs[6].default_value = socket.default_value
            mat.node_tree.links.new(mix.outputs[2], socket)


def repaint(objs, rgb):
    for o in objs:
        for mat in o.data.materials:
            if mat is None or mat.name in _tinted:
                continue
            _tinted.add(mat.name)
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            for link in list(bsdf.inputs["Base Color"].links):
                mat.node_tree.links.remove(link)
            bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)


def pre_matrix(variant):
    m = Matrix.Identity(4)
    if variant.get("lay"):
        m = Matrix.Rotation(math.pi / 2, 4, "X") @ m
    return Matrix.Rotation(math.radians(variant.get("turn_deg", 0.0)), 4, "Z") @ m


def instance(manifest, variant, link):
    templates = _load(manifest["files"]["blend"], variant["pick"])
    pre = pre_matrix(variant)
    objs, lo, hi = [], [math.inf] * 3, [-math.inf] * 3
    for t in templates:
        basis = pre @ t.matrix_basis
        for corner in t.bound_box:
            p = basis @ Vector(corner)
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
        o = t.copy()
        o.matrix_basis = basis
        link(o)
        objs.append(o)
    if variant.get("tint"):
        tint_materials(objs, variant["tint"], variant.get("tint_only"))
    if variant.get("paint"):
        repaint(objs, variant["paint"])
    return objs, lo, hi


def fit(holder, lo, hi, box_in, mode="stretch"):
    t_lo = [in_to_m(v) for v in box_in[0]]
    t_hi = [in_to_m(v) for v in box_in[1]]
    extent = [max(hi[i] - lo[i], 1e-6) for i in range(3)]
    scale = [(t_hi[i] - t_lo[i]) / extent[i] for i in range(3)]
    if mode == "contain":
        scale = [min(scale)] * 3
    room = [(t_hi[i] - t_lo[i]) - scale[i] * extent[i] for i in range(3)]
    holder.scale = scale
    holder.location = [t_lo[i] + (room[i] / 2.0 if i < 2 else 0.0) - scale[i] * lo[i] for i in range(3)]
