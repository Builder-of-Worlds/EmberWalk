import { describe, expect, it, vi } from "vitest";
import { cacheNameFor, handles, install, removeOldCaches, respond, shellUrls } from "../../src/offline.ts";
import { FakeCaches } from "./fake-caches.ts";

const SCOPE = "https://app.emberwalk.test/";
const PRECACHE = { version: "v1", files: ["assets/index-abc.js", "assets/index-def.css", "manifest.webmanifest"] };

const navigate = (url: string): Request => {
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

describe("shellUrls", () => {
  it("lists the page itself first, then every precached file, as absolute links", () => {
    expect(shellUrls(PRECACHE, SCOPE)).toEqual([
      "https://app.emberwalk.test/",
      "https://app.emberwalk.test/assets/index-abc.js",
      "https://app.emberwalk.test/assets/index-def.css",
      "https://app.emberwalk.test/manifest.webmanifest",
    ]);
  });
});

describe("install", () => {
  it("stores the whole app shell in the cache named for this version", async () => {
    const caches = new FakeCaches();
    await install(caches.asStorage(), PRECACHE, SCOPE);
    expect([...caches.stores.keys()]).toEqual(["emberwalk-app-v1"]);
    expect([...(caches.stores.get("emberwalk-app-v1")?.entries.keys() ?? [])]).toEqual(shellUrls(PRECACHE, SCOPE));
  });

  it("fails when any file of the shell cannot be fetched, so a half shell is never trusted", async () => {
    const caches = new FakeCaches(async (url) => new Response("", { status: url.endsWith(".css") ? 404 : 200 }));
    await expect(install(caches.asStorage(), PRECACHE, SCOPE)).rejects.toThrow(/404/);
  });
});

describe("removeOldCaches", () => {
  it("deletes earlier app versions and keeps the current one and caches it does not own", async () => {
    const caches = new FakeCaches();
    await caches.open(cacheNameFor("old"));
    await caches.open(cacheNameFor("v1"));
    await caches.open("someone-else");
    expect(await removeOldCaches(caches.asStorage(), "v1")).toEqual(["emberwalk-app-old"]);
    expect(await caches.keys()).toEqual(["emberwalk-app-v1", "someone-else"]);
  });
});

describe("handles", () => {
  it("takes same origin GET requests for the app's files", () => {
    expect(handles(new Request(`${SCOPE}assets/index-abc.js`), SCOPE)).toBe(true);
  });

  it("leaves the API, other methods and other origins to the network", () => {
    expect(handles(new Request(`${SCOPE}api/uploads`), SCOPE)).toBe(false);
    expect(handles(new Request(`${SCOPE}assets/x.js`, { method: "POST" }), SCOPE)).toBe(false);
    expect(handles(new Request("https://bucket.r2.test/emberwalk-media/a"), SCOPE)).toBe(false);
  });
});

describe("respond", () => {
  it("answers a page visit with the cached shell page, without the network", async () => {
    const caches = new FakeCaches();
    await install(caches.asStorage(), PRECACHE, SCOPE);
    const network = vi.fn(async () => new Response("network"));
    const response = await respond(navigate(`${SCOPE}#/record`), caches.asStorage(), "v1", SCOPE, network);
    expect(await response.text()).toBe(`body of ${SCOPE}`);
    expect(network).not.toHaveBeenCalled();
  });

  it("answers a cached file from the cache", async () => {
    const caches = new FakeCaches();
    await install(caches.asStorage(), PRECACHE, SCOPE);
    const network = vi.fn(async () => new Response("network"));
    const response = await respond(new Request(`${SCOPE}assets/index-abc.js`), caches.asStorage(), "v1", SCOPE, network);
    expect(await response.text()).toBe(`body of ${SCOPE}assets/index-abc.js`);
    expect(network).not.toHaveBeenCalled();
  });

  it("answers a cached file even when the server varied its answer on a request header", async () => {
    const caches = new FakeCaches(async (url) => new Response(`body of ${url}`, { headers: { vary: "Accept" } }));
    await install(caches.asStorage(), PRECACHE, SCOPE);
    const network = vi.fn(async () => new Response("network"));
    const request = new Request(`${SCOPE}assets/index-abc.js`, { headers: { accept: "*/*" } });
    const response = await respond(request, caches.asStorage(), "v1", SCOPE, network);
    expect(await response.text()).toBe(`body of ${SCOPE}assets/index-abc.js`);
  });

  it("goes to the network for a file the shell does not hold", async () => {
    const caches = new FakeCaches();
    await install(caches.asStorage(), PRECACHE, SCOPE);
    const network = vi.fn(async () => new Response("network"));
    const response = await respond(new Request(`${SCOPE}other.png`), caches.asStorage(), "v1", SCOPE, network);
    expect(await response.text()).toBe("network");
  });

  it("reads only the current version's cache", async () => {
    const caches = new FakeCaches();
    await install(caches.asStorage(), PRECACHE, SCOPE);
    const network = vi.fn(async () => new Response("network"));
    const response = await respond(new Request(`${SCOPE}assets/index-abc.js`), caches.asStorage(), "v2", SCOPE, network);
    expect(await response.text()).toBe("network");
  });
});
