import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, draft, walkDate } from "../../src/copy.ts";
import { INTRO_SEEN_KEY, storagePrefs } from "../../src/prefs.ts";
import { resultsFor, resultsIdIn, ROUTES, sendFor, takeIdIn, WALK_START } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { HOW_LINES } from "../../src/screens/How.tsx";
import { grantedMedia, memoryPrefs, memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { OFF_SCREEN, SETTLED_HOME, SETTLED_HOW, shownLines } from "./settled.ts";

const go = (hash: string) =>
  settle(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const walkLink = (host: HTMLElement) => host.querySelector<HTMLAnchorElement>("a.primary");

const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`no button "${label}" in: ${host.textContent}`);
  return found;
};

afterEach(() => {
  window.location.hash = "";
});

describe("routes", () => {
  it("opens a walk on this phone by its id, and nothing else", () => {
    expect(takeIdIn(sendFor("take 1/2"))).toBe("take 1/2");
    expect(takeIdIn(ROUTES.send)).toBeNull();
    expect(takeIdIn(`${ROUTES.send}/`)).toBeNull();
    expect(takeIdIn(`${ROUTES.send}/%E0%A4%A`)).toBeNull();
    expect(takeIdIn("#/record/abc")).toBeNull();
    expect(takeIdIn(resultsFor("take 1"))).toBeNull();
  });

  it("opens results by their id, and nothing else", () => {
    expect(resultsIdIn(resultsFor("walk 1/2"))).toBe("walk 1/2");
    expect(resultsIdIn(ROUTES.results)).toBeNull();
    expect(resultsIdIn(`${ROUTES.results}/`)).toBeNull();
    expect(resultsIdIn(`${ROUTES.results}/%E0%A4%A`)).toBeNull();
    expect(resultsIdIn(sendFor("walk 1"))).toBeNull();
  });
});

describe("Home", () => {
  it("shows only settled copy, with no language switch yet", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", Date.UTC(2026, 9, 26, 18, 30));
    await takes.append(take.id, new Blob(["walk"]));
    const view = await render(<App deps={deps} />);
    await until(() => view.text().includes(copy.home.walks));
    const allowed = new Set([...SETTLED_HOME, walkDate(take.createdAt)]);
    for (const line of shownLines(view.host)) expect(allowed, line).toContain(line);
    for (const line of [...OFF_SCREEN, draft.home.lead]) expect(view.text()).not.toContain(line);
    await view.unmount();
  });

  it("opens each sample house there is, and only those", async () => {
    const view = await render(<App deps={testDeps()} />);
    const samples = [...view.host.querySelectorAll("a")].filter((a) => a.textContent === "See a Sample House");
    expect(samples.map((a) => a.getAttribute("href"))).toEqual(SAMPLES.map((s) => resultsFor(s.id)));
    expect(SAMPLES.length).toBeGreaterThan(0);
    await view.unmount();
  });

  it("lists walks saved on this phone, newest first, each with a way to send it", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const older = await takes.create("video/mp4", 1000);
    await takes.append(older.id, new Blob(["old walk"]));
    const newer = await takes.create("video/mp4", 2000);
    await takes.append(newer.id, new Blob(["new walk"]));
    const view = await render(<App deps={deps} />);
    await until(() => view.host.querySelectorAll(".walks li").length === 2);
    expect(view.host.querySelector(".walks h2")?.textContent).toBe(copy.home.walks);
    const links = [...view.host.querySelectorAll<HTMLAnchorElement>(".walks a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([sendFor(newer.id), sendFor(older.id)]);
    expect(links.map((a) => a.textContent)).toEqual([copy.home.send, copy.home.send]);
    const described = links[0]?.getAttribute("aria-describedby") ?? "";
    expect(view.host.querySelector(`[id="${described}"]`)?.textContent).toBe(walkDate(2000));
    await view.unmount();
  });

  it("opens a listed walk on the send screen", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1000);
    await takes.append(take.id, new Blob(["walk"]));
    await takes.create("video/mp4", 2000);
    const view = await render(<App deps={deps} />);
    await go(sendFor(take.id));
    await until(() => view.text().includes(copy.send.saved));
    await go(sendFor("not-on-this-phone"));
    await until(() => view.text().includes(copy.send.none));
    await view.unmount();
  });

  it("leaves out walks with no video in them, and the heading when there are none", async () => {
    const deps = testDeps();
    await (await deps.takes()).create("video/mp4", 1000);
    const view = await render(<App deps={deps} />);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.host.querySelector(".walks")).toBeNull();
    expect(view.text()).not.toContain(copy.home.walks);
    await view.unmount();
  });
});

describe("How Your Walk Works", () => {
  it("shows only settled copy", async () => {
    window.location.hash = ROUTES.how;
    const view = await render(<App deps={testDeps()} />);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.how.title);
    const lines = shownLines(view.host);
    for (const line of lines) expect(SETTLED_HOW, line).toContain(line);
    expect(lines).toEqual([copy.how.title, ...HOW_LINES, copy.how.continue]);
    await view.unmount();
  });

  it("names all four things the walk asks for, location last", () => {
    expect(HOW_LINES).toEqual([copy.how.walk, copy.how.asks, copy.how.camera, copy.how.microphone, copy.how.motion, copy.how.location]);
    expect(HOW_LINES.slice(HOW_LINES.indexOf(copy.how.asks) + 1)).toHaveLength(4);
  });

  it("comes before the first walk, once, then Walk My House goes straight to the walk", async () => {
    const storage = memoryStorage();
    const view = await render(<App deps={testDeps({ prefs: memoryPrefs(storage) })} />);
    expect(walkLink(view.host)?.getAttribute("href")).toBe(ROUTES.how);
    await go(ROUTES.how);
    await settle(() => button(view.host, copy.how.continue).click());
    expect(window.location.hash).toBe(WALK_START);
    expect(storage.getItem(INTRO_SEEN_KEY)).toBe("1");
    await go(ROUTES.home);
    expect(walkLink(view.host)?.getAttribute("href")).toBe(WALK_START);
    await view.unmount();
    const reopened = await render(<App deps={testDeps({ prefs: memoryPrefs(storage) })} />);
    expect(walkLink(reopened.host)?.getAttribute("href")).toBe(WALK_START);
    await reopened.unmount();
  });

  it("still comes once in this visit when the phone refuses to store that it was seen", async () => {
    const prefs = storagePrefs(refusingStorage);
    const view = await render(<App deps={testDeps({ prefs })} />);
    expect(walkLink(view.host)?.getAttribute("href")).toBe(ROUTES.how);
    await go(ROUTES.how);
    await settle(() => button(view.host, copy.how.continue).click());
    expect(window.location.hash).toBe(WALK_START);
    await go(ROUTES.home);
    expect(walkLink(view.host)?.getAttribute("href")).toBe(WALK_START);
    await view.unmount();
  });

  it("reads a stored answer other than seen as not seen", () => {
    const storage = memoryStorage();
    storage.setItem(INTRO_SEEN_KEY, "true");
    expect(memoryPrefs(storage).introSeen()).toBe(false);
  });
});

describe("permissions", () => {
  it("asks for the camera and microphone only when recording starts, never at first open or on step 2", async () => {
    const media = grantedMedia();
    const view = await render(<App deps={testDeps({ media })} />);
    await go(ROUTES.how);
    await settle(() => button(view.host, copy.how.continue).click());
    await settle(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await until(() => view.text().includes(copy.record.start));
    expect(media.getUserMedia).not.toHaveBeenCalled();
    await settle(() => button(view.host, copy.record.start).click());
    await until(() => media.getUserMedia.mock.calls.length === 1);
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, video: expect.anything() }));
    await view.unmount();
  });

  it("never asks the browser for location or motion on home or step 2", async () => {
    const geolocation = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: geolocation });
    const motion = vi.fn(async () => "granted");
    Object.defineProperty(globalThis, "DeviceMotionEvent", { configurable: true, value: { requestPermission: motion } });
    const view = await render(<App deps={testDeps()} />);
    await go(ROUTES.how);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(motion).not.toHaveBeenCalled();
    await view.unmount();
  });
});
