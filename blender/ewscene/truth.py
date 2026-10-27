import json

from . import geom, placement, units


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


def dumps(doc):
    body = dict(doc)
    samples = body.pop("samples", None)
    text = json.dumps(body, indent=2)
    if samples is None:
        return text + "\n"
    rows = ",\n".join("    " + json.dumps(s) for s in samples)
    return text[:-2] + ',\n  "samples": [\n' + rows + "\n  ]\n}\n"
