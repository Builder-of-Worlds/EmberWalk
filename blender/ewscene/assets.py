import datetime
import hashlib
import http.client
import json
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request

CATALOG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets.json")
API = "https://api.polyhaven.com/"
DOWNLOAD_HOST = "https://dl.polyhaven.org/"
USER_AGENT = "EmberWalk-scene-builder/0.1"
SERVER_TYPES = {0: "hdri", 1: "texture", 2: "model"}
TEXTURE_MAPS = ("Diffuse", "Rough", "nor_gl")
ID = re.compile(r"^polyhaven:([a-z0-9_]+)$")


class AssetError(Exception):
    pass


def load_catalog():
    with open(CATALOG, encoding="utf-8") as f:
        return json.load(f)


def cache_dir():
    root = os.environ.get("EMBERWALK_ASSETS") or os.path.expanduser("~/emberwalk-assets")
    return os.path.join(root, "polyhaven")


def used(spec, catalog):
    ids = [spec["wall"]["material"], spec["wall"]["roof_material"], spec["ground"]["material"], spec["light"]["hdri"]]
    for h in spec["hazards"]:
        ids.append(h["asset"])
        if "material" in catalog[h["asset"]]:
            ids.append(catalog[h["asset"]]["material"])
    out = []
    for asset_id in dict.fromkeys(ids):
        entry = catalog[asset_id]
        out.append({"id": asset_id, "kind": entry["kind"], "license": entry["license"], "source": entry.get("source")})
    return out


def _get(opener, url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener(request, timeout=60) as response:
            return response.read()
    except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
        raise AssetError("could not fetch %s: %s" % (url, e))


def _get_json(opener, url):
    try:
        return json.loads(_get(opener, url).decode("utf-8"))
    except ValueError:
        raise AssetError("not JSON: %s" % url)


def _pick(files, key, res, formats):
    try:
        by_format = files[key][res]
    except (KeyError, TypeError):
        raise AssetError("no %s at %s" % (key, res))
    for fmt in formats:
        if fmt in by_format:
            return by_format[fmt]
    raise AssetError("no %s file for %s at %s" % ("/".join(formats), key, res))


def _plan(kind, files, res):
    if kind == "texture":
        out = {}
        for key in TEXTURE_MAPS:
            item = _pick(files, key, res, ("jpg", "png"))
            out[key] = (os.path.basename(item["url"]), item)
        return out, {}
    if kind == "hdri":
        item = _pick(files, "hdri", res, ("hdr",))
        return {"hdri": (os.path.basename(item["url"]), item)}, {}
    item = _pick(files, "blend", res, ("blend",))
    extras = {}
    for rel, inc in item.get("include", {}).items():
        norm = os.path.normpath(rel)
        if os.path.isabs(norm) or norm.split(os.sep)[0] == "..":
            raise AssetError("include path leaves the cache: %s" % rel)
        extras[norm] = (norm, inc)
    return {"blend": (os.path.basename(item["url"]), item)}, extras


def _md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure(asset_id, entry, cache, opener=urllib.request.urlopen):
    m = ID.match(asset_id)
    path = os.path.join(cache, m.group(1), "asset.json") if m else ""
    manifest = _cached(path, entry["resolution"]) if os.path.isfile(path) else None
    return manifest or fetch(asset_id, entry, cache, opener)


def _cached(path, res):
    try:
        with open(path, encoding="utf-8") as f:
            manifest = json.load(f)
        paths = list(manifest["files"].values()) + list(manifest.get("includes", []))
        if manifest["resolution"] == res and all(os.path.isfile(p) for p in paths):
            return manifest
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return None


def _write_manifest(asset_root, manifest):
    fd, tmp = tempfile.mkstemp(prefix=".asset-", suffix=".json", dir=asset_root)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        os.replace(tmp, os.path.join(asset_root, "asset.json"))
    except BaseException:
        os.unlink(tmp)
        raise


def fetch(asset_id, entry, cache, opener=urllib.request.urlopen):
    m = ID.match(asset_id)
    if not m:
        raise AssetError("not a Poly Haven asset id: %s" % asset_id)
    name, kind, res = m.group(1), entry["kind"], entry["resolution"]
    info = _get_json(opener, API + "info/" + name)
    if SERVER_TYPES.get(info.get("type")) != kind:
        raise AssetError("%s is not a %s on Poly Haven" % (asset_id, kind))
    files, extras = _plan(kind, _get_json(opener, API + "files/" + name), res)
    asset_root = os.path.join(cache, name)
    final = os.path.join(asset_root, res)
    jobs = list(files.values()) + list(extras.values())
    os.makedirs(asset_root, exist_ok=True)
    partial = tempfile.mkdtemp(prefix=".partial-", dir=asset_root)
    try:
        for rel, item in jobs:
            if not item["url"].startswith(DOWNLOAD_HOST):
                raise AssetError("download is not on %s: %s" % (DOWNLOAD_HOST, item["url"]))
            target = os.path.join(final, rel)
            if os.path.isfile(target) and _md5(target) == item["md5"]:
                continue
            data = _get(opener, item["url"])
            if hashlib.md5(data).hexdigest() != item["md5"] or len(data) != item["size"]:
                raise AssetError("checksum mismatch for %s" % item["url"])
            tmp = os.path.join(partial, rel)
            os.makedirs(os.path.dirname(tmp), exist_ok=True)
            with open(tmp, "wb") as f:
                f.write(data)
        for rel, _ in jobs:
            tmp = os.path.join(partial, rel)
            if os.path.isfile(tmp):
                os.makedirs(os.path.dirname(os.path.join(final, rel)), exist_ok=True)
                os.replace(tmp, os.path.join(final, rel))
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        try:
            os.rmdir(asset_root)
        except OSError:
            pass
        raise
    shutil.rmtree(partial, ignore_errors=True)
    manifest = {
        "id": asset_id,
        "kind": kind,
        "license": entry["license"],
        "source": "https://polyhaven.com/a/" + name,
        "resolution": res,
        "files": {key: os.path.join(final, rel) for key, (rel, _) in files.items()},
        "includes": [os.path.join(final, rel) for rel in extras],
        "retrieved": datetime.date.today().isoformat(),
    }
    if kind == "texture":
        dims = info.get("dimensions") or [2000, 2000]
        manifest["size_m"] = [dims[0] / 1000.0, dims[1] / 1000.0]
    _write_manifest(asset_root, manifest)
    return manifest
