import hashlib


def variants(entry, form="default"):
    return list((entry.get("photoscan") or {}).get(form, []))


def choose(options, key):
    return options[int(hashlib.md5(key.encode("utf-8")).hexdigest(), 16) % len(options)]


def used_ids(entry):
    return [v["id"] for forms in (entry.get("photoscan") or {}).values() for v in forms]
