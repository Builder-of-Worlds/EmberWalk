import { describe, expect, it } from "vitest";
import { KEPT_STILLS, keptStills } from "../../src/kept-stills.ts";
import type { Shelf } from "../../src/kept-stills.ts";

const photo = (text: string) => new Blob([text], { type: "image/jpeg" });

const fakeShelf = (): Shelf & { held: Map<string, Response> } => {
  const held = new Map<string, Response>();
  const name = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request));
  return {
    held,
    match: async (request) => held.get(name(request))?.clone(),
    put: async (request, response) => void held.set(name(request), response),
    keys: async () => [...held.keys()].map((key) => new Request(key)),
    delete: async (request) => held.delete(name(request)),
  };
};

const STILL = "/api/walks/w1/stills/a.jpg";

describe("proof photos kept for reading with no signal", () => {
  it("returns the photo the network gave and keeps it", async () => {
    const shelf = fakeShelf();
    const stills = keptStills(async () => photo("one"), async () => shelf);
    expect(await (await stills(STILL))?.text()).toBe("one");
    expect(shelf.held.size).toBe(1);
  });

  it("returns the kept photo when the network gives none, and null when nothing was kept", async () => {
    const shelf = fakeShelf();
    await keptStills(async () => photo("one"), async () => shelf)(STILL);
    const offline = keptStills(async () => null, async () => shelf);
    const kept = await offline(STILL);
    expect(await kept?.text()).toBe("one");
    expect(kept?.type).toBe("image/jpeg");
    expect(await offline("/api/walks/w1/stills/b.jpg")).toBeNull();
  });

  it("finds the same photo whatever the page origin or query", async () => {
    const shelf = fakeShelf();
    await keptStills(async () => photo("one"), async () => shelf)(`https://a.example${STILL}?x=1`);
    expect(await (await keptStills(async () => null, async () => shelf)(`https://b.example${STILL}`))?.text()).toBe("one");
  });

  it("keeps only the newest photos", async () => {
    const shelf = fakeShelf();
    const stills = keptStills(async () => photo("x"), async () => shelf);
    for (let i = 0; i < KEPT_STILLS + 5; i++) await stills(`/api/walks/w1/stills/${i}.jpg`);
    expect(shelf.held.size).toBe(KEPT_STILLS);
    expect(shelf.held.has("https://phone.invalid/api/walks/w1/stills/0.jpg")).toBe(false);
    expect(shelf.held.has(`https://phone.invalid/api/walks/w1/stills/${KEPT_STILLS + 4}.jpg`)).toBe(true);
  });

  it("works with no shelf and when the shelf throws", async () => {
    expect(await (await keptStills(async () => photo("one"), async () => null)(STILL))?.text()).toBe("one");
    expect(await keptStills(async () => null, async () => null)(STILL)).toBeNull();
    const broken: Shelf = {
      match: async () => {
        throw new Error("denied");
      },
      put: async () => {
        throw new Error("denied");
      },
      keys: async () => [],
      delete: async () => false,
    };
    expect(await (await keptStills(async () => photo("one"), async () => broken)(STILL))?.text()).toBe("one");
    expect(await keptStills(async () => null, async () => broken)(STILL)).toBeNull();
  });
});
