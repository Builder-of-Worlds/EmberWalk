import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeCaches } from "./fake-caches.ts";

const SCOPE = "https://app.emberwalk.test/";
type Listener = (event: unknown) => void;

const loadWorker = async (precache: unknown) => {
  const listeners = new Map<string, Listener>();
  const caches = new FakeCaches();
  const scope = {
    __EMBERWALK_PRECACHE: precache,
    caches: caches.asStorage(),
    registration: { scope: SCOPE },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    fetch: vi.fn(async () => new Response("network")),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  for (const [key, value] of Object.entries(scope)) vi.stubGlobal(key, value);
  vi.resetModules();
  await import("../../src/sw.ts");
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    listeners.get(type)?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    await Promise.all(waits);
    return responded as Promise<Response> | null;
  };
  return { scope, caches, fire };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("service worker", () => {
  it("refuses to start without its precache list", async () => {
    await expect(loadWorker(undefined)).rejects.toThrow(/precache list/);
  });

  it("caches the shell on install and takes over at once", async () => {
    const { scope, caches, fire } = await loadWorker({ version: "v1", files: ["assets/a.js"] });
    await fire("install");
    expect([...(caches.stores.get("emberwalk-app-v1")?.entries.keys() ?? [])]).toEqual([SCOPE, `${SCOPE}assets/a.js`]);
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it("removes old versions on activate and claims open pages", async () => {
    const { scope, caches, fire } = await loadWorker({ version: "v2", files: [] });
    await caches.open("emberwalk-app-v1");
    await fire("activate");
    expect(await caches.keys()).toEqual([]);
    expect(scope.clients.claim).toHaveBeenCalledOnce();
  });

  it("answers app files from the cache and leaves API calls alone", async () => {
    const { fire } = await loadWorker({ version: "v1", files: ["assets/a.js"] });
    await fire("install");
    const answered = await fire("fetch", { request: new Request(`${SCOPE}assets/a.js`) });
    expect(await (await answered)?.text()).toBe(`body of ${SCOPE}assets/a.js`);
    expect(await fire("fetch", { request: new Request(`${SCOPE}api/uploads`, { method: "POST" }) })).toBeNull();
  });

  it("falls through to the network for files outside the shell", async () => {
    const { scope, fire } = await loadWorker({ version: "v1", files: [] });
    await fire("install");
    const answered = await fire("fetch", { request: new Request(`${SCOPE}late.png`) });
    expect(await (await answered)?.text()).toBe("network");
    expect(scope.fetch).toHaveBeenCalledOnce();
  });
});
