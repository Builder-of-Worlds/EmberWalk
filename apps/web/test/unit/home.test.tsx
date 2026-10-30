import type { WalkPart, WalkState } from "@emberwalk/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, draft, walkDate } from "../../src/copy.ts";
import { INTRO_SEEN_KEY, storagePrefs } from "../../src/prefs.ts";
import { checkingFor, resultsFor, resultsIdIn, routeFor, ROUTES, sendFor, takeIdIn, walkIdIn, WALK_START } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { HOW_LINES } from "../../src/screens/How.tsx";
import { OPENS_IN_MS } from "../../src/screens/Send.tsx";
import { SENT_WALKS_KEY, storageSentWalks } from "../../src/sent-walks.ts";
import type { SendResult } from "../../src/uploader.ts";
import { POLL_MS } from "../../src/watch.ts";
import type { WalkStatus } from "../../src/watch.ts";
import { fakeClock, grantedMedia, memoryPrefs, memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
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

  it("opens a walk being checked by its id, and nothing else", () => {
    expect(walkIdIn(checkingFor("walk 1/2"))).toBe("walk 1/2");
    expect(routeFor(checkingFor("walk 1"))).toBe("checking");
    expect(walkIdIn(ROUTES.checking)).toBeNull();
    expect(walkIdIn(`${ROUTES.checking}/`)).toBeNull();
    expect(walkIdIn(`${ROUTES.checking}/%E0%A4%A`)).toBeNull();
    expect(walkIdIn(resultsFor("walk 1"))).toBeNull();
    expect(takeIdIn(checkingFor("walk 1"))).toBeNull();
  });
});

describe("Home, walks still being checked", () => {
  const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";

  const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLLIElement>(".walks li.checking")];

  const progressLink = (card: HTMLElement) => card.querySelector<HTMLAnchorElement>("a.button");

  it("shows a card for each, newest first, with its date, that it is still being checked and See Progress to its checking screen", async () => {
    const deps = testDeps();
    deps.sentWalks.add({ walkId: "older", opens: "older", takeId: "t-1", createdAt: 1000 });
    deps.sentWalks.add({ walkId: WALK, opens: WALK, takeId: "t-2", createdAt: 2000 });
    const view = await render(<App deps={deps} />);
    await until(() => cards(view.host).length === 2);
    expect(view.host.querySelector(".walks h2")?.textContent).toBe(copy.home.walks);
    const [newer, older] = cards(view.host);
    expect(newer!.textContent).toContain(walkDate(2000));
    expect(newer!.textContent).toContain(copy.send.refused.walk_not_done);
    expect(progressLink(newer!)?.textContent).toBe("See Progress");
    expect(progressLink(newer!)?.getAttribute("href")).toBe(checkingFor(WALK));
    expect(progressLink(older!)?.getAttribute("href")).toBe(checkingFor("older"));
    expect(view.host.querySelector(`[id="${progressLink(newer!)?.getAttribute("aria-describedby")}"]`)?.textContent).toBe(walkDate(2000));
    const allowed = new Set([...SETTLED_HOME, copy.send.refused.walk_not_done, walkDate(1000), walkDate(2000)]);
    for (const line of shownLines(view.host)) expect(allowed, line).toContain(line);
    await view.unmount();
  });

  it("lists a sent walk's video once, as its card, never again as a walk to send", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 3000);
    await takes.append(take.id, new Blob(["walk"]));
    await takes.saveUpload(take.id, { walkId: WALK, uploadId: null, partBytes: 1, partCount: 1, parts: [] });
    const unsent = await takes.create("video/mp4", 1000);
    await takes.append(unsent.id, new Blob(["other walk"]));
    deps.sentWalks.add({ walkId: WALK, opens: WALK, takeId: take.id, createdAt: 3000 });
    const view = await render(<App deps={deps} />);
    await until(() => view.host.querySelectorAll(".walks li").length === 2);
    expect(cards(view.host)).toHaveLength(1);
    expect([...view.host.querySelectorAll(".walks a")].map((a) => a.getAttribute("href"))).toEqual([checkingFor(WALK), sendFor(unsent.id)]);
    await view.unmount();
  });

  it("lists the walks of the latest answer, never a slower earlier one that arrives afterwards", async () => {
    const saved = async (deps: ReturnType<typeof testDeps>, createdAt: number) => {
      const takes = await deps.takes();
      const take = await takes.create("video/mp4", createdAt);
      await takes.append(take.id, new Blob(["walk"]));
      return takes;
    };
    const slow = testDeps();
    const slowStore = await saved(slow, 1_700_000_000_000);
    let release: (store: typeof slowStore) => void = () => undefined;
    slow.takes = () => new Promise((resolve) => (release = resolve));
    const fast = testDeps();
    await saved(fast, 1_800_000_000_000);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<App deps={slow} />));
    await act(async () => root.render(<App deps={fast} />));
    await until(() => host.textContent?.includes(walkDate(1_800_000_000_000)) === true);
    await act(async () => release(slowStore));
    expect(host.textContent).toContain(walkDate(1_800_000_000_000));
    expect(host.textContent).not.toContain(walkDate(1_700_000_000_000));
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows no card when what is stored is not a sent walk", async () => {
    const storage = memoryStorage();
    storage.setItem(SENT_WALKS_KEY, "{not a list");
    const view = await render(<App deps={testDeps({ sentWalks: storageSentWalks(() => storage) })} />);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.host.querySelector(".walks")).toBeNull();
    expect(view.text()).not.toContain("See Progress");
    await view.unmount();
  });

  const sendThenLeave = async (answers: (WalkState | "offline" | "unknown_walk")[], partOf: WalkPart | null = null) => {
    const time = fakeClock();
    const walkStatus: WalkStatus = async (walkId) => {
      const state = answers.shift() ?? { name: "queued" };
      if (typeof state === "string") return { code: state };
      return { value: { walkId, state, failure: state.name === "failed" ? { code: "pipeline_failed", message: "Failed." } : null } };
    };
    let finish: (result: SendResult) => void = () => undefined;
    const results = async (id: string) => ({ ...SAMPLES[0]!, id });
    const deps = testDeps({ clock: time.clock, walkStatus, results, send: () => new Promise((resolve) => (finish = resolve)) });
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 4000, { jurisdiction: null, sound: true, partOf });
    await takes.append(take.id, new Blob(["walk"]));
    window.location.hash = sendFor(take.id);
    const view = await render(<App deps={deps} />);
    await until(() => view.text().includes(copy.leaves.send));
    await settle(() => button(view.host, copy.leaves.send).click());
    await settle(() => finish({ walkId: WALK }));
    await until(() => view.text().includes(copy.send.refused.walk_not_done));
    await takes.saveUpload(take.id, { walkId: WALK, uploadId: null, partBytes: 1, partCount: 1, parts: [] });
    await go(ROUTES.home);
    await until(() => cards(view.host).length === 1);
    expect(view.host.querySelectorAll(".walks li")).toHaveLength(1);
    expect(cards(view.host)[0]?.textContent).toContain(walkDate(4000));
    return { view, time, takes, take, sentWalks: deps.sentWalks };
  };

  it("brings the homeowner back from Home to the walk's checking screen, which opens the results at done and drops the card", async () => {
    const { view, time, sentWalks } = await sendThenLeave([{ name: "queued" }, { name: "processing", step: "segment" }, { name: "done" }]);
    await settle(() => progressLink(cards(view.host)[0]!)?.click());
    await go(checkingFor(WALK));
    await until(() => view.text().includes("Looking for what needs clearing."));
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
    await settle(() => time.advance(POLL_MS));
    await until(() => sentWalks.get(WALK) === null);
    await settle(() => time.advance(OPENS_IN_MS));
    await until(() => view.host.querySelector("main.results") !== null);
    expect(window.location.hash).toBe(resultsFor(WALK));
    await go(ROUTES.home);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(cards(view.host)).toHaveLength(0);
    await view.unmount();
  });

  it("opens the whole walk's results at done when the walk sent was one side walked again", async () => {
    const PARENT = "0b0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b02";
    const { view, time, sentWalks } = await sendThenLeave([{ name: "queued" }, { name: "done" }], { walkId: PARENT, side: "back" });
    await go(checkingFor(WALK));
    await until(() => sentWalks.get(WALK) === null);
    await settle(() => time.advance(OPENS_IN_MS));
    await until(() => view.host.querySelector("main.results") !== null);
    expect(window.location.hash).toBe(resultsFor(PARENT));
    await view.unmount();
  });

  it("keeps the sent video on the phone from the checking screen until the check is done, then lets it go", async () => {
    const { view, takes, time, sentWalks } = await sendThenLeave(["offline", { name: "queued" }, { name: "done" }]);
    expect(await takes.all()).toHaveLength(1);
    await go(checkingFor(WALK));
    await until(() => view.text().includes(copy.send.step({ name: "queued" })));
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(await takes.all()).toHaveLength(1);
    expect(sentWalks.get(WALK)).not.toBeNull();
    await settle(() => time.advance(POLL_MS));
    for (let i = 0; i < 50 && (await takes.all()).length > 0; i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
    expect(await takes.all()).toHaveLength(0);
    await view.unmount();
  });

  const sendsTheSameWalk = async (view: Awaited<ReturnType<typeof sendThenLeave>>["view"], takeId: string) => {
    await until(() => [...view.host.querySelectorAll("button")].some((b) => b.textContent === copy.leaves.send));
    expect(view.text()).toContain(copy.send.saved);
    expect(view.text()).not.toContain(copy.send.lost);
    expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)).toBeNull();
    await settle(() => button(view.host, copy.leaves.send).click());
    expect(window.location.hash).toBe(sendFor(takeId));
  };

  it("drops the card when the server no longer knows the walk, and offers the same video to send again", async () => {
    const { view, sentWalks, take } = await sendThenLeave([{ name: "queued" }, "unknown_walk"]);
    await go(checkingFor(WALK));
    await sendsTheSameWalk(view, take.id);
    expect(sentWalks.get(WALK)).toBeNull();
    await view.unmount();
  });

  it("drops the card once the check has failed, says so on the checking screen, and lists the same video to send again", async () => {
    const { view, sentWalks, take } = await sendThenLeave([{ name: "queued" }, { name: "failed", step: "score" }]);
    await go(checkingFor(WALK));
    await until(() => view.host.querySelector("[role=alert]")?.textContent === "Failed.");
    expect(sentWalks.get(WALK)).toBeNull();
    await sendsTheSameWalk(view, take.id);
    await go(ROUTES.home);
    await until(() => view.host.querySelectorAll(".walks a").length === 1);
    expect(cards(view.host)).toHaveLength(0);
    expect(view.host.querySelector(".walks a")?.getAttribute("href")).toBe(sendFor(take.id));
    await view.unmount();
  });

  it("says there is no walk when the checking screen has no walk id", async () => {
    window.location.hash = ROUTES.checking;
    const view = await render(<App deps={testDeps()} />);
    expect(view.text()).toContain(copy.send.none);
    await view.unmount();
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
