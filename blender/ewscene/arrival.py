import os

from . import probe


class ArrivalError(Exception):
    def __init__(self, kind, message):
        super().__init__("arrival %s: %s" % (kind, message))
        self.kind = kind


def _need(doc, *keys):
    if not isinstance(doc, dict):
        raise ArrivalError("invalid", "not an object")
    for k in keys:
        if k not in doc:
            raise ArrivalError("invalid", "missing %s" % k)


def _name(rel):
    if not isinstance(rel, str):
        raise ArrivalError("invalid", "file is not a name")
    if os.path.isabs(rel) or ".." in rel.split("/"):
        raise ArrivalError("refused", "%s leaves the renders folder" % rel)
    return rel


def entries(doc):
    if not isinstance(doc, dict):
        raise ArrivalError("invalid", "not an object")
    kind = doc.get("schema")
    if kind == "emberwalk.render/1":
        _need(doc, "file", "size_bytes", "sha256")
        return [(_name(doc["file"]), doc["size_bytes"], doc["sha256"])]
    _need(doc, "scene", "stills")
    stills = doc["stills"]
    if not isinstance(stills, list):
        raise ArrivalError("invalid", "stills is not a list")
    if kind == "emberwalk.openart-look/1":
        out = []
        for s in stills:
            _need(s, "original")
            _need(s["original"], "file", "bytes", "sha256")
            out.append((_name("%s/%s" % (doc["scene"], s["original"]["file"])), s["original"]["bytes"], s["original"]["sha256"]))
        return out
    if kind == "emberwalk.recheck/1":
        out = []
        for s in stills:
            _need(s, "file", "sha256")
            out.append((_name("%s/recheck/%s" % (doc["scene"], s["file"])), None, s["sha256"]))
        return out
    raise ArrivalError("invalid", "schema %s lists no files kept outside git" % kind)


def problems(found, root):
    out = []
    for rel, size, digest in found:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            out.append("%s: missing" % rel)
        elif size is not None and os.path.getsize(path) != size:
            out.append("%s: %d bytes, the record says %d" % (rel, os.path.getsize(path), size))
        elif probe.sha256(path) != digest:
            out.append("%s: sha256 differs from the record" % rel)
    return out
