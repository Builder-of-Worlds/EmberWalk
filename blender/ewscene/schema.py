import json
import math
import os
import re

SCHEMA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schemas")

ANNOTATIONS = {"$schema", "$id", "title", "description", "$comment"}
KEYWORDS = {
    "type", "required", "properties", "additionalProperties", "enum", "const", "minimum",
    "maximum", "exclusiveMinimum", "minLength", "pattern", "items", "minItems", "maxItems",
}
TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def load(name):
    with open(os.path.join(SCHEMA_DIR, name + ".schema.json"), encoding="utf-8") as f:
        return json.load(f)


def _kind(v):
    for name in ("boolean", "integer", "number", "string", "null", "array", "object"):
        if TYPES[name](v):
            return name


def _same(a, b):
    if _kind(a) != _kind(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    return a == b


def _anchored(pattern):
    if not pattern.endswith("$"):
        return pattern
    head = pattern[:-1]
    if (len(head) - len(head.rstrip("\\"))) % 2:
        return pattern
    return head + "\\Z"


def errors(value, sch, path="$"):
    unknown = set(sch) - KEYWORDS - ANNOTATIONS
    if unknown:
        raise ValueError("schema keyword not supported: %s" % ", ".join(sorted(unknown)))
    if isinstance(value, float) and not math.isfinite(value):
        return ["%s: not finite" % path]
    if "type" in sch:
        types = sch["type"] if isinstance(sch["type"], list) else [sch["type"]]
        if not any(TYPES[t](value) for t in types):
            return ["%s: not %s" % (path, " or ".join(types))]
    out = []
    if "const" in sch and not _same(value, sch["const"]):
        out.append("%s: not %s" % (path, json.dumps(sch["const"])))
    if "enum" in sch and not any(_same(value, e) for e in sch["enum"]):
        out.append("%s: not one of %s" % (path, ", ".join(json.dumps(e) for e in sch["enum"])))
    if TYPES["number"](value):
        if "minimum" in sch and value < sch["minimum"]:
            out.append("%s: below %s" % (path, sch["minimum"]))
        if "maximum" in sch and value > sch["maximum"]:
            out.append("%s: above %s" % (path, sch["maximum"]))
        if "exclusiveMinimum" in sch and value <= sch["exclusiveMinimum"]:
            out.append("%s: not above %s" % (path, sch["exclusiveMinimum"]))
    if isinstance(value, str):
        if "minLength" in sch and len(value) < sch["minLength"]:
            out.append("%s: shorter than %d" % (path, sch["minLength"]))
        if "pattern" in sch and not re.search(_anchored(sch["pattern"]), value):
            out.append("%s: does not match %s" % (path, sch["pattern"]))
    if isinstance(value, list):
        if "minItems" in sch and len(value) < sch["minItems"]:
            out.append("%s: fewer than %d items" % (path, sch["minItems"]))
        if "maxItems" in sch and len(value) > sch["maxItems"]:
            out.append("%s: more than %d items" % (path, sch["maxItems"]))
        if "items" in sch:
            for i, item in enumerate(value):
                out.extend(errors(item, sch["items"], "%s[%d]" % (path, i)))
    if isinstance(value, dict):
        for key in sch.get("required", []):
            if key not in value:
                out.append("%s: missing %s" % (path, key))
        props = sch.get("properties", {})
        for key, item in value.items():
            if key in props:
                out.extend(errors(item, props[key], "%s.%s" % (path, key)))
            elif sch.get("additionalProperties") is False:
                out.append("%s: unknown key %s" % (path, key))
    return out
