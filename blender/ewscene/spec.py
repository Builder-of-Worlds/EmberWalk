import json

from . import placement, schema


class SpecError(Exception):
    def __init__(self, kind, message):
        super().__init__("%s spec: %s" % (kind, message))
        self.kind = kind


def load(path, catalog):
    with open(path, encoding="utf-8") as f:
        return validate(json.load(f), catalog)


def validate(doc, catalog):
    errs = schema.errors(doc, schema.load("scene-spec"))
    if errs:
        raise SpecError("invalid", "; ".join(errs))
    _refusals(doc, catalog)
    _geometry(doc)
    return doc


def _asset(catalog, asset_id, kind, where):
    entry = catalog.get(asset_id)
    if entry is None:
        raise SpecError("refused", "%s: unknown asset %s" % (where, asset_id))
    if entry["kind"] not in kind:
        raise SpecError("refused", "%s: %s is not a %s" % (where, asset_id, " or ".join(kind)))
    return entry


def _refusals(doc, catalog):
    _asset(catalog, doc["wall"]["material"], ("texture",), "wall.material")
    _asset(catalog, doc["wall"]["roof_material"], ("texture",), "wall.roof_material")
    _asset(catalog, doc["ground"]["material"], ("texture",), "ground.material")
    _asset(catalog, doc["light"]["hdri"], ("hdri",), "light.hdri")
    for i, h in enumerate(doc["hazards"]):
        where = "hazards[%d]" % i
        if h["distance_in"] < 0:
            raise SpecError("refused", "%s.distance_in: negative distance %d" % (where, h["distance_in"]))
        if h["distance_in"] > placement.MAX_DISTANCE_IN:
            raise SpecError("refused", "%s.distance_in: %d in is past 100 feet" % (where, h["distance_in"]))
        entry = _asset(catalog, h["asset"], ("model", "scripted"), where + ".asset")
        if h["concept"] not in entry["concepts"]:
            raise SpecError("refused", "%s.asset: %s is not a %s" % (where, h["asset"], h["concept"]))


def _geometry(doc):
    wall_len = doc["wall"]["length_in"]
    depth = doc["ground"]["depth_in"]
    walk = doc["walk"]
    boxes = []
    seen = set()
    for i, h in enumerate(doc["hazards"]):
        where = "hazards[%d]" % i
        if h["id"] in seen:
            raise SpecError("invalid", "%s.id: duplicate %s" % (where, h["id"]))
        seen.add(h["id"])
        box = placement.hazard_box(h)
        if box[1][0] > wall_len:
            raise SpecError("invalid", "%s.along_in: runs past the wall end at %d in" % (where, wall_len))
        if box[1][1] > depth:
            raise SpecError("invalid", "%s: reaches past the ground edge at %d in" % (where, depth))
        for j, other in enumerate(boxes):
            if placement.overlaps(box, other):
                raise SpecError("invalid", "%s overlaps hazards[%d]" % (where, j))
        boxes.append(box)
    if walk["end_along_in"] <= walk["start_along_in"] or walk["end_along_in"] > wall_len:
        raise SpecError("invalid", "walk.end_along_in: must be after the start and within the wall")
    if walk["standoff_in"] >= depth:
        raise SpecError("invalid", "walk.standoff_in: past the ground edge")
    for i, box in enumerate(boxes):
        if placement.crosses_walk(box, walk["standoff_in"], walk["start_along_in"], walk["end_along_in"]):
            raise SpecError("invalid", "walk: passes through hazards[%d]" % i)
