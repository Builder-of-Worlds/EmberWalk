import json

from . import geom, maskbox, placement, units

PASS_SCHEMA = "emberwalk.mask-pass/1"
BOX_SOURCE = "tightest rectangle round the pixels of the hazard in a flat colour pass of the render, one pass per frame"
VISIBLE_RULE_MASK = "a hazard is visible on a frame when its pixels in the render's mask pass number at least %d; its box is the tightest rectangle round them" % maskbox.MIN_MASK_PX


def _visible(box, motion):
    foot = ((box[0][0] + box[1][0]) / 2.0, box[0][1], 0.0)
    return [i for i, s in enumerate(motion["samples"]) if geom.in_frame(geom.project(foot, s, motion["camera"]), motion["camera"])]


def _windows(seen, samples):
    out = []
    for n, i in enumerate(seen):
        if n and i == seen[n - 1] + 1:
            out[-1][1] = samples[i]["t"]
        else:
            out.append([samples[i]["t"], samples[i]["t"]])
    return out


def hazard(spec, h, motion):
    box = placement.hazard_box(h)
    d = placement.distance_from_wall(box)
    seen = _visible(box, motion)
    return {
        "id": h["id"],
        "concept": h["concept"],
        "side": spec["side"],
        "distance_in": d,
        "distance_ft": round(d / 12.0, 2),
        "distance_text": units.feet_inches(d),
        "band": placement.band(d),
        "contact": d == 0,
        "label": h["label"],
        "rule": h["rule"],
        "asset": h["asset"],
        "box_in": {"min": list(box[0]), "max": list(box[1])},
        "visible_frames": len(seen),
        "visible_s": _windows(seen, motion["samples"]),
    }


def build(spec, motion):
    return {
        "schema": "emberwalk.truth/1",
        "synthetic": True,
        "label": spec["label"],
        "scene": spec["id"],
        "side": spec["side"],
        "units": "inch",
        "axes": motion["conventions"]["pos_in"],
        "visible_rule": "a hazard is visible on a frame when the middle of its box face nearest the wall, at ground level, projects inside the image",
        "wall": {"length_in": spec["wall"]["length_in"], "height_in": spec["wall"]["height_in"], "face_y_in": 0},
        "hazards": [hazard(spec, h, motion) for h in spec["hazards"]],
    }


class MaskPassError(Exception):
    pass


def _check_box(where, hit, width, height):
    box = hit.get("box_px") if isinstance(hit, dict) else None
    area = hit.get("area_px") if isinstance(hit, dict) else None
    if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, int) and not isinstance(v, bool) for v in box)):
        raise MaskPassError("%s: box_px must be four whole numbers" % where)
    left, top, right, bottom = box
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise MaskPassError("%s: box %s is empty or outside the %dx%d image" % (where, box, width, height))
    if not (isinstance(area, int) and not isinstance(area, bool) and maskbox.MIN_MASK_PX <= area <= (right - left) * (bottom - top)):
        raise MaskPassError("%s: area_px %s does not fit a box of %d px" % (where, area, (right - left) * (bottom - top)))


def _findings(doc):
    return doc["hazards"] + doc.get("structure_hazards", [])


def _ids(doc):
    return {h["id"] for h in _findings(doc)}


def _check_pass(mask_pass, doc, walk):
    if not isinstance(mask_pass, dict) or mask_pass.get("schema") != PASS_SCHEMA:
        raise MaskPassError("not an %s document" % PASS_SCHEMA)
    cam = walk["camera"]
    if (mask_pass.get("width"), mask_pass.get("height")) != (cam["width_px"], cam["height_px"]):
        raise MaskPassError("pass is %sx%s, the walk is %dx%d" % (mask_pass.get("width"), mask_pass.get("height"), cam["width_px"], cam["height_px"]))
    frames = mask_pass.get("frames")
    if not isinstance(frames, list) or [f.get("frame") if isinstance(f, dict) else None for f in frames] != list(range(1, walk["frame_count"] + 1)):
        raise MaskPassError("frames must run 1 to %d with none missing" % walk["frame_count"])
    ids = _ids(doc)
    for f in frames:
        found = f.get("boxes")
        if not isinstance(found, dict) or set(found) != ids:
            raise MaskPassError("frame %d: boxes must name exactly %s" % (f["frame"], sorted(ids)))
        for hazard_id, hit in found.items():
            if hit is not None:
                _check_box("frame %d, %s" % (f["frame"], hazard_id), hit, cam["width_px"], cam["height_px"])


def without_ids(mask_pass, doc, names):
    """The pass minus the boxes of the ids in names that the doc no longer lists.

    Any other id is left in, so the check still refuses it."""
    frames = mask_pass.get("frames") if isinstance(mask_pass, dict) else None
    if not isinstance(frames, list):
        return mask_pass
    keep = _ids(doc)
    out = dict(mask_pass)
    out["frames"] = [
        dict(f, boxes={k: v for k, v in f["boxes"].items() if k in keep or k not in names})
        if isinstance(f, dict) and isinstance(f.get("boxes"), dict) else f
        for f in frames
    ]
    return out


def attach_boxes(doc, mask_pass, walk):
    _check_pass(mask_pass, doc, walk)
    samples = walk["samples"]
    out = json.loads(json.dumps(doc))
    out["visible_rule"] = VISIBLE_RULE_MASK
    out["box_source"] = BOX_SOURCE
    for h in _findings(out):
        rows = [(f["frame"], f["boxes"][h["id"]]) for f in mask_pass["frames"] if f["boxes"][h["id"]] is not None]
        h["frame_boxes"] = [
            {"frame": n, "t": samples[n - 1]["t"], "box_px": hit["box_px"], "area_px": hit["area_px"]} for n, hit in rows
        ]
        h["visible_frames"] = len(rows)
        h["visible_s"] = _windows([n - 1 for n, _ in rows], samples)
    return out


def dumps(doc):
    body = dict(doc)
    samples = body.pop("samples", None)
    text = json.dumps(body, indent=2)
    if samples is None:
        return text + "\n"
    rows = ",\n".join("    " + json.dumps(s) for s in samples)
    return text[:-2] + ',\n  "samples": [\n' + rows + "\n  ]\n}\n"
