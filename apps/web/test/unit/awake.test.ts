import { describe, expect, it } from "vitest";
import { browserAwake } from "../../src/awake.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const screen = (refuse = false) => {
  const log: string[] = [];
  const nav = {
    wakeLock: {
      request: async (type: "screen") => {
        log.push(`request ${type}`);
        if (refuse) throw new DOMException("not allowed", "NotAllowedError");
        return { release: async () => void log.push("release") };
      },
    },
  };
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  return { log, nav, doc: doc as unknown as Document & { visibilityState: DocumentVisibilityState } };
};

describe("keeping the screen awake", () => {
  it("asks for a screen lock when held and releases it when let go", async () => {
    const { log, nav, doc } = screen();
    const letGo = browserAwake(nav, doc).hold();
    await flush();
    expect(log).toEqual(["request screen"]);
    letGo();
    await flush();
    expect(log).toEqual(["request screen", "release"]);
  });

  it("takes the lock again when the page comes back to the front, and not after it was let go", async () => {
    const { log, nav, doc } = screen();
    const letGo = browserAwake(nav, doc).hold();
    await flush();
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(log.filter((line) => line === "request screen")).toHaveLength(2);
    letGo();
    await flush();
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(log.filter((line) => line === "request screen")).toHaveLength(2);
  });

  it("does not ask while the page is hidden", async () => {
    const { log, nav, doc } = screen();
    const letGo = browserAwake(nav, doc).hold();
    await flush();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(log).toEqual(["request screen"]);
    letGo();
  });

  it("releases a lock that arrives after it was let go", async () => {
    const { log, nav, doc } = screen();
    browserAwake(nav, doc).hold()();
    await flush();
    expect(log).toEqual(["request screen", "release"]);
  });

  it("carries on when the browser refuses or has no screen lock", async () => {
    const refused = screen(true);
    const letGo = browserAwake(refused.nav, refused.doc).hold();
    await flush();
    expect(() => letGo()).not.toThrow();
    const without = screen();
    expect(() => browserAwake({}, without.doc).hold()()).not.toThrow();
  });
});
