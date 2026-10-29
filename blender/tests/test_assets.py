import hashlib
import http.client
import io
import json
import os
import tempfile
import unittest
import urllib.error

import support
from ewscene import assets


def md5(data):
    return hashlib.md5(data).hexdigest()


class FakeWeb:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.calls.append(url)
        if url not in self.routes:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        body = self.routes[url]
        return io.BytesIO(body if isinstance(body, bytes) else json.dumps(body).encode())


DIFF = b"diffuse-bytes"
ROUGH = b"rough-bytes"
NOR = b"normal-bytes"
BLEND = b"blend-bytes"
TEX = b"texture-bytes"
HDR = b"hdr-bytes"
DL = "https://dl.polyhaven.org/file/ph-assets/"


def texture_routes(diff=DIFF):
    return {
        "https://api.polyhaven.com/info/weathered_plank_siding": {"type": 1, "dimensions": [2000, 2000]},
        "https://api.polyhaven.com/files/weathered_plank_siding": {
            "Diffuse": {"2k": {"jpg": {"url": DL + "d.jpg", "md5": md5(DIFF), "size": len(DIFF)}}},
            "Rough": {"2k": {"jpg": {"url": DL + "r.jpg", "md5": md5(ROUGH), "size": len(ROUGH)}}},
            "nor_gl": {"2k": {"jpg": {"url": DL + "n.jpg", "md5": md5(NOR), "size": len(NOR)}}},
        },
        DL + "d.jpg": diff,
        DL + "r.jpg": ROUGH,
        DL + "n.jpg": NOR,
    }


class Catalog(unittest.TestCase):
    def test_every_entry_is_cleared(self):
        for asset_id, entry in assets.load_catalog().items():
            with self.subTest(asset=asset_id):
                if entry["kind"] == "scripted":
                    self.assertTrue(asset_id.startswith("scripted:"))
                else:
                    self.assertTrue(asset_id.startswith("polyhaven:"))
                    self.assertEqual(entry["license"], "CC0-1.0")
                    self.assertEqual(entry["source"], "https://polyhaven.com/a/" + asset_id.split(":", 1)[1])

    def test_every_sky_is_shaped_like_the_test_yard_sky(self):
        catalog = assets.load_catalog()
        skies = {i: e for i, e in catalog.items() if e["kind"] == "hdri"}
        self.assertTrue({"polyhaven:goegap", "polyhaven:dreifaltigkeitsberg"} <= set(skies))
        for asset_id, entry in skies.items():
            with self.subTest(asset=asset_id):
                self.assertEqual(sorted(entry), sorted(skies["polyhaven:goegap"]))
                self.assertEqual(entry["resolution"], skies["polyhaven:goegap"]["resolution"])

    def test_scripted_material_is_in_the_catalog(self):
        catalog = assets.load_catalog()
        for entry in catalog.values():
            if entry["kind"] == "scripted":
                self.assertEqual(catalog[entry["material"]]["kind"], "texture")

    def test_used_lists_every_asset_once(self):
        used = assets.used(support.sample_spec(), assets.load_catalog())
        ids = [u["id"] for u in used]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("polyhaven:goegap", ids)
        self.assertIn("polyhaven:bark_brown_02", ids)
        self.assertTrue(all(u["license"] for u in used))


class Fetch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def entry(self, kind="texture", res="2k"):
        return {"kind": kind, "license": "CC0-1.0", "resolution": res}

    def test_texture_fetch_writes_maps_and_manifest(self):
        web = FakeWeb(texture_routes())
        man = assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        self.assertEqual(sorted(man["files"]), ["Diffuse", "Rough", "nor_gl"])
        self.assertEqual(man["license"], "CC0-1.0")
        self.assertEqual(man["size_m"], [2.0, 2.0])
        with open(man["files"]["Diffuse"], "rb") as f:
            self.assertEqual(f.read(), DIFF)
        with open(os.path.join(self.cache, "weathered_plank_siding", "asset.json")) as f:
            self.assertEqual(json.load(f)["id"], "polyhaven:weathered_plank_siding")

    def test_second_fetch_uses_the_cache(self):
        assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        web = FakeWeb(texture_routes())
        assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        self.assertFalse(any(u.startswith(DL) for u in web.calls))

    def test_ensure_is_offline_once_cached(self):
        first = assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        web = FakeWeb({})
        again = assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        self.assertEqual(web.calls, [])
        self.assertEqual(again["files"], first["files"])

    def test_ensure_fetches_again_when_a_file_is_gone(self):
        man = assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        os.remove(man["files"]["Rough"])
        web = FakeWeb(texture_routes())
        assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        self.assertIn(DL + "r.jpg", web.calls)
        self.assertTrue(os.path.isfile(man["files"]["Rough"]))

    def test_ensure_fetches_again_for_another_resolution(self):
        assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        web = FakeWeb({})
        with self.assertRaises(assets.AssetError):
            assets.ensure("polyhaven:weathered_plank_siding", self.entry(res="1k"), self.cache, web)
        self.assertTrue(web.calls)

    def test_bad_checksum_is_refused_and_not_kept(self):
        web = FakeWeb(texture_routes(diff=b"tampered-bytes"))
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        self.assertFalse(os.path.exists(os.path.join(self.cache, "weathered_plank_siding", "asset.json")))
        leftovers = [n for _, _, names in os.walk(self.cache) for n in names]
        self.assertEqual(leftovers, [])

    def test_ensure_fetches_again_when_the_manifest_is_broken(self):
        ensure = lambda web: assets.ensure("polyhaven:weathered_plank_siding", self.entry(), self.cache, web)
        path = os.path.join(self.cache, "weathered_plank_siding", "asset.json")
        for broken in ('{"id": "polyhaven:weath', "[]", '{"resolution": "2k"}', '{"resolution": "2k", "files": 3}'):
            with self.subTest(manifest=broken):
                ensure(FakeWeb(texture_routes()))
                with open(path, "w") as f:
                    f.write(broken)
                web = FakeWeb(texture_routes())
                man = ensure(web)
                self.assertIn("https://api.polyhaven.com/files/weathered_plank_siding", web.calls)
                with open(path) as f:
                    self.assertEqual(json.load(f), man)

    def test_a_failed_manifest_write_keeps_the_old_manifest(self):
        first = assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        real_dump = json.dump

        def half_dump(obj, f, **kw):
            f.write('{"id": ')
            raise OSError("disk full")

        assets.json.dump = half_dump
        try:
            with self.assertRaises(OSError):
                assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(texture_routes()))
        finally:
            assets.json.dump = real_dump
        root = os.path.join(self.cache, "weathered_plank_siding")
        with open(os.path.join(root, "asset.json")) as f:
            self.assertEqual(json.load(f), first)
        self.assertEqual(sorted(os.listdir(root)), ["2k", "asset.json"])

    def test_a_broken_http_response_is_an_asset_error(self):
        class Broken:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                raise http.client.IncompleteRead(b"par", 10)

        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, lambda r, timeout=None: Broken())

    def test_any_failure_leaves_nothing_behind(self):
        routes = texture_routes()
        web = FakeWeb(routes)
        real = web.__call__

        def flaky(request, timeout=None):
            if request.full_url == DL + "n.jpg":
                raise RuntimeError("interrupted")
            return real(request, timeout)

        with self.assertRaises(RuntimeError):
            assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, flaky)
        self.assertEqual(os.listdir(self.cache), [])

    def test_a_failed_run_does_not_spoil_another_run(self):
        good = FakeWeb(texture_routes())
        bad = FakeWeb(texture_routes(diff=b"tampered-bytes"))
        state = {"nested": False}

        def outer(request, timeout=None):
            if request.full_url == DL + "r.jpg" and not state["nested"]:
                state["nested"] = True
                with self.assertRaises(assets.AssetError):
                    assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, bad)
            return good(request, timeout)

        man = assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, outer)
        self.assertTrue(state["nested"])
        for key, path in man["files"].items():
            with self.subTest(map=key):
                self.assertTrue(os.path.isfile(path))
        root = os.path.join(self.cache, "weathered_plank_siding")
        self.assertEqual(sorted(os.listdir(root)), ["2k", "asset.json"])

    def test_model_fetch_brings_its_textures(self):
        web = FakeWeb({
            "https://api.polyhaven.com/info/dry_branches_medium_01": {"type": 2},
            "https://api.polyhaven.com/files/dry_branches_medium_01": {"blend": {"1k": {"blend": {
                "url": DL + "m.blend", "md5": md5(BLEND), "size": len(BLEND),
                "include": {"textures/t.jpg": {"url": DL + "t.jpg", "md5": md5(TEX), "size": len(TEX)}},
            }}}},
            DL + "m.blend": BLEND,
            DL + "t.jpg": TEX,
        })
        man = assets.fetch("polyhaven:dry_branches_medium_01", self.entry("model", "1k"), self.cache, web)
        root = os.path.dirname(man["files"]["blend"])
        self.assertTrue(os.path.isfile(os.path.join(root, "textures", "t.jpg")))
        os.remove(os.path.join(root, "textures", "t.jpg"))
        web.calls = []
        assets.ensure("polyhaven:dry_branches_medium_01", self.entry("model", "1k"), self.cache, web)
        self.assertIn(DL + "t.jpg", web.calls)

    def test_model_include_cannot_escape_the_cache(self):
        web = FakeWeb({
            "https://api.polyhaven.com/info/dry_branches_medium_01": {"type": 2},
            "https://api.polyhaven.com/files/dry_branches_medium_01": {"blend": {"1k": {"blend": {
                "url": DL + "m.blend", "md5": md5(BLEND), "size": len(BLEND),
                "include": {"../../evil.jpg": {"url": DL + "t.jpg", "md5": md5(TEX), "size": len(TEX)}},
            }}}},
            DL + "m.blend": BLEND,
            DL + "t.jpg": TEX,
        })
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:dry_branches_medium_01", self.entry("model", "1k"), self.cache, web)

    def test_hdri_fetch(self):
        web = FakeWeb({
            "https://api.polyhaven.com/info/dry_meadow": {"type": 0},
            "https://api.polyhaven.com/files/dry_meadow": {"hdri": {"2k": {"hdr": {"url": DL + "h.hdr", "md5": md5(HDR), "size": len(HDR)}}}},
            DL + "h.hdr": HDR,
        })
        man = assets.fetch("polyhaven:dry_meadow", self.entry("hdri"), self.cache, web)
        self.assertTrue(man["files"]["hdri"].endswith(".hdr"))

    def test_wrong_type_on_the_server_is_refused(self):
        web = FakeWeb({"https://api.polyhaven.com/info/dry_meadow": {"type": 1}})
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:dry_meadow", self.entry("hdri"), self.cache, web)

    def test_missing_asset_is_refused(self):
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb({}))

    def test_download_off_the_asset_host_is_refused(self):
        routes = texture_routes()
        routes["https://api.polyhaven.com/files/weathered_plank_siding"]["Diffuse"]["2k"]["jpg"]["url"] = "https://example.com/d.jpg"
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:weathered_plank_siding", self.entry(), self.cache, FakeWeb(routes))

    def test_bad_id_is_refused_before_any_request(self):
        web = FakeWeb({})
        with self.assertRaises(assets.AssetError):
            assets.fetch("polyhaven:../x", self.entry(), self.cache, web)
        with self.assertRaises(assets.AssetError):
            assets.fetch("scripted:wood_pile", self.entry(), self.cache, web)
        self.assertEqual(web.calls, [])

    def test_cache_dir_follows_the_environment(self):
        old = os.environ.get("EMBERWALK_ASSETS")
        try:
            os.environ["EMBERWALK_ASSETS"] = self.cache
            self.assertEqual(assets.cache_dir(), os.path.join(self.cache, "polyhaven"))
            del os.environ["EMBERWALK_ASSETS"]
            self.assertEqual(assets.cache_dir(), os.path.expanduser("~/emberwalk-assets/polyhaven"))
        finally:
            if old is not None:
                os.environ["EMBERWALK_ASSETS"] = old


if __name__ == "__main__":
    unittest.main()
