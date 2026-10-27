import { afterEach, describe, expect, it } from "vitest";
import { walkApi } from "../../src/api.ts";
import { App } from "../../src/App.tsx";
import { copy, draft, longDate, unbacked } from "../../src/copy.ts";
import { apiResults, samplesThenApi } from "../../src/live-results.ts";
import { marksKey } from "../../src/finding-marks.ts";
import { storagePrefs, VIEW_KEY } from "../../src/prefs.ts";
import type { WalkResults } from "../../src/results.ts";
import { resultsFor, ROUTES, WALK_START } from "../../src/router.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { fakeClock, memoryMarks, memoryPrefs, memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, LIVE_WALK, liveBody, liveFindingId, walk } from "./result-fakes.ts";
import { NEVER_SAID, SETTLED_GAPS, SETTLED_RESULTS, SETTLED_STATUS, shownLines } from "./settled.ts";

const SIMPLE_PARTS = ["photo", "sentence", "label", "status"];
const DETAILED_PARTS = [...SIMPLE_PARTS, "citations"];

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const open = async (results: WalkResults, over: Parameters<typeof testDeps>[0] = {}) => {
  window.location.hash = resultsFor(results.id);
  const deps = testDeps({ results: async (id) => (id === results.id ? results : null), ...over });
  const view = await render(<App deps={deps} />);
  await until(() => view.host.querySelector("h1") !== null);
  return { ...view, deps, h1: () => view.host.querySelector("h1")?.textContent };
};

const pick = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no button "${label}"`);
  await settle(() => button.click());
};

const parts = (host: HTMLElement) =>
  [...host.querySelectorAll("li.finding")].map((li) => [...li.querySelectorAll("[data-part]")].map((el) => el.getAttribute("data-part")));

const GAP = { side: "back", kind: "missing" } as const;

afterEach(() => {
  window.location.hash = "";
});

describe("Results, step 9", () => {
  it("shows only settled copy in both views, and never the words it must not say", async () => {
    const results = walk([finding("a", feet(2)), finding("b", { band: "zone_0", ...feet(1) })], [], { synthetic: true });
    const view = await open(results);
    for (const chosen of [copy.results.detailed, copy.results.simple]) {
      await pick(view.host, chosen);
      const allowed = new Set([...SETTLED_RESULTS, ...SETTLED_STATUS, copy.results.walked(new Date(Date.UTC(2026, 9, 26, 12))), ...results.findings.flatMap((f) => [f.instruction, ...f.sources.map((s) => s.citation)])]);
      for (const line of shownLines(view.host)) expect(allowed, line).toContain(line);
      for (const word of NEVER_SAID) expect(view.text().toLowerCase()).not.toContain(word);
      for (const line of Object.values(draft.results)) expect(view.text()).not.toContain(line(5));
    }
    await view.unmount();
  });

  it("never shows green while the walk is incomplete, and lists each gap and what was found so far", async () => {
    const view = await open(walk([finding("a")], [GAP, { side: "left", kind: "dark" }, { side: "right", kind: "first_five_feet" }]));
    expect(view.h1()).toBe(copy.results.incomplete);
    expect([...view.host.querySelectorAll("ul.lines li")].map((li) => li.textContent)).toEqual(SETTLED_GAPS);
    expect(view.host.querySelector("main")?.dataset.verdict).toBe("incomplete");
    expect(view.host.querySelector(".green")).toBeNull();
    for (const line of [copy.results.ready, copy.results.allClear, copy.results.insurance, copy.results.startHere]) expect(view.text()).not.toContain(line);
    expect(view.host.querySelector("h2")?.textContent).toBe(copy.results.soFar);
    expect([...view.host.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([copy.results.bands.zone_1]);
    expect(view.host.querySelectorAll("li.finding")).toHaveLength(1);
    await view.unmount();
  });

  it("offers Walk Again on an incomplete walk of your own, not on a sample house", async () => {
    const own = await open(walk([], [GAP]));
    const again = [...own.host.querySelectorAll("a")].find((a) => a.textContent === copy.results.walkAgain);
    expect(again?.getAttribute("href")).toBe(ROUTES.how);
    expect(own.text()).not.toContain(copy.results.soFar);
    await own.unmount();
    const prefs = memoryPrefs();
    prefs.markIntroSeen();
    const seen = await open(walk([], [GAP]), { prefs });
    expect([...seen.host.querySelectorAll("a")].find((a) => a.textContent === copy.results.walkAgain)?.getAttribute("href")).toBe(WALK_START);
    await seen.unmount();
    const sample = await open(walk([], [GAP], { synthetic: true }));
    expect(sample.text()).not.toContain(copy.results.walkAgain);
    await sample.unmount();
  });

  it("counts the items to fix first in its heading, sorted Required Now first, then distance", async () => {
    const list = [
      finding("rec-near", { label: "recommended", band: "zone_0", ...feet(1) }),
      finding("req-far", { band: "zone_2", ...feet(40) }),
      finding("req-near", feet(6)),
      finding("req-mid", feet(12)),
    ];
    for (const [shown, heading] of [[1, "Fix This First"], [2, "Fix These 2 First"], [4, "Fix These 3 First"]] as const) {
      const view = await open(walk(list.slice(-shown)));
      expect(view.h1()).toBe(heading);
      await view.unmount();
    }
    const view = await open(walk(list));
    expect(view.text()).toContain(copy.results.startHere);
    const first = view.host.querySelector("main > ul.findings")!;
    expect([...first.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["req-near", "req-mid", "req-far"]);
    const bands = [...view.host.querySelectorAll("section.band")].map((s) => [s.querySelector("h2")?.textContent, [...s.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))]);
    expect(bands).toEqual([
      ["First 5 Feet", ["rec-near"]],
      ["5 to 30 Feet", ["req-near", "req-mid"]],
      ["30 to 100 Feet", ["req-far"]],
    ]);
    await view.unmount();
  });

  it("says why a Recommended item inside the first 5 feet sits alone under Start here", async () => {
    const view = await open(walk([finding("rec-near", { label: "recommended", band: "zone_0", ...feet(1) })]));
    expect(view.h1()).toBe("Fix This First");
    expect([...view.host.querySelectorAll("main > ul.findings li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["rec-near"]);
    expect(shownLines(view.host)).toContain("Start here: closest to your house, and required by your rules or inside the first 5 feet.");
    await view.unmount();
  });

  it("shows green with its date and the insurance line only when nothing blocks it", async () => {
    const view = await open(walk([finding("far", { label: "recommended", band: "zone_2", ...feet(40) })]));
    expect(view.h1()).toBe(copy.results.ready);
    expect(view.host.querySelector(".green")?.textContent).toBe(copy.results.allClear);
    expect(view.text()).toContain(copy.results.insurance);
    expect(view.text()).toContain("Walked Monday, October 26th, 2026.");
    expect(view.text()).not.toContain(copy.results.startHere);
    await view.unmount();
    const fix = await open(walk([finding("a")]));
    expect(fix.text()).not.toContain(copy.results.insurance);
    expect(fix.host.querySelector(".green")).toBeNull();
    await fix.unmount();
  });

  it("never shows green on a walk whose coverage is not checked, in either view", async () => {
    const far = finding("far", { label: "recommended", band: "zone_2", ...feet(40) });
    for (const findings of [[], [far]]) {
      const view = await open(walk(findings, [], { coverage: "not_checked", notChecked: ["roof_debris"] }));
      for (const chosen of [copy.results.detailed, copy.results.simple]) {
        await pick(view.host, chosen);
        expect(view.h1()).toBe(copy.results.soFar);
        expect(view.host.querySelector("main")?.dataset.verdict).toBe("so_far");
        expect(view.host.querySelector(".green")).toBeNull();
        for (const line of [copy.results.ready, copy.results.allClear, copy.results.insurance]) expect(view.text()).not.toContain(line);
        for (const line of shownLines(view.host)) expect([...SETTLED_RESULTS, ...SETTLED_STATUS, far.instruction, ...far.sources.map((s) => s.citation), copy.results.walked(new Date(Date.UTC(2026, 9, 26, 12)))], line).toContain(line);
      }
      expect(view.host.querySelectorAll("li.finding")).toHaveLength(findings.length);
      await view.unmount();
    }
  });

  it("opens a walk from the API with its findings, labelled only when the API calls it synthetic", async () => {
    for (const synthetic of [false, true]) {
      const body = liveBody(LIVE_WALK, 2, { synthetic });
      const walks = walkApi("https://ember.test", async () => Response.json(body), () => "c".repeat(64));
      const view = await open({ ...walk([]), id: LIVE_WALK }, { results: samplesThenApi(sampleResults, apiResults(walks, "https://ember.test")) });
      expect(view.h1()).toBe(copy.results.soFar);
      expect([...view.host.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual([liveFindingId(1), liveFindingId(2)]);
      expect(view.text().includes(copy.results.sample), `synthetic ${synthetic}`).toBe(synthetic);
      await view.unmount();
    }
  });

  it("holds the not checked line off screen until it is ruled", async () => {
    const view = await open(walk([], [], { coverage: "not_checked", notChecked: ["roof_debris", "wood_pile"] }));
    for (const concept of ["roof_debris", "wood_pile"] as const) expect(view.text()).not.toContain(unbacked.results.notChecked(concept));
    expect(view.host.querySelector("ul.not-checked")).toBeNull();
    await view.unmount();
  });

  it("says a result over a year old needs a new walk", async () => {
    const old = await open(walk([]), { clock: fakeClock(Date.UTC(2027, 9, 26)).clock });
    expect(old.text()).toContain(copy.results.old);
    await old.unmount();
    const fresh = await open(walk([]), { clock: fakeClock(Date.UTC(2027, 9, 25)).clock });
    expect(fresh.text()).not.toContain(copy.results.old);
    await fresh.unmount();
  });

  it("labels every sample house, and no walk of your own", async () => {
    const sample = await open(walk([], [], { synthetic: true }));
    expect(sample.host.querySelector("h1 + p")?.textContent).toBe(copy.results.sample);
    await sample.unmount();
    const own = await open(walk([]));
    expect(own.text()).not.toContain(copy.results.sample);
    await own.unmount();
  });

  it("goes home when there are no results to show", async () => {
    window.location.hash = resultsFor("not-here");
    const view = await render(<App deps={testDeps()} />);
    await until(() => window.location.hash === ROUTES.home);
    await view.unmount();
  });
});

describe("Simple and Detailed", () => {
  it("shows only the photo, the sentence, the label and the status in Simple, and adds every citation in Detailed", async () => {
    const two = finding("a", { sources: [finding("x").sources[0]!, finding("y").sources[0]!] });
    const view = await open(walk([two], [GAP]));
    expect(view.host.querySelector("main")?.dataset.view).toBe("simple");
    expect(parts(view.host)).toEqual([SIMPLE_PARTS]);
    expect(view.text()).not.toContain("Rule for x");
    await pick(view.host, copy.results.detailed);
    expect(parts(view.host)).toEqual([DETAILED_PARTS]);
    expect([...view.host.querySelectorAll(".citations li")].map((li) => li.textContent)).toEqual(["Rule for x", "Rule for y"]);
    await view.unmount();
  });

  it("marks the proof photo with its box", async () => {
    const view = await open(walk([finding("a", { proof: { still: "a.jpg", frame: 2, seconds: 1, marker: [0.25, 0.5, 0.75, 1] } })]));
    expect(view.host.querySelector(".proof img")?.getAttribute("src")).toBe("a.jpg");
    const marker = view.host.querySelector<HTMLElement>(".marker")!.style;
    expect([marker.left, marker.top, marker.width, marker.height]).toEqual(["25%", "50%", "50%", "50%"]);
    await view.unmount();
  });

  it("remembers the chosen view on this phone", async () => {
    const storage = memoryStorage();
    const first = await open(walk([finding("a")]), { prefs: memoryPrefs(storage) });
    const pressed = () => [...first.host.querySelectorAll("[aria-pressed=true]")].map((b) => b.textContent);
    expect(pressed()).toEqual([copy.results.simple]);
    await pick(first.host, copy.results.detailed);
    expect(pressed()).toEqual([copy.results.detailed]);
    expect(storage.getItem(VIEW_KEY)).toBe("detailed");
    await first.unmount();
    const again = await open(walk([finding("a")]), { prefs: memoryPrefs(storage) });
    expect(again.host.querySelector("main")?.dataset.view).toBe("detailed");
    expect(parts(again.host)).toEqual([DETAILED_PARTS, DETAILED_PARTS]);
    await again.unmount();
  });

  it("falls back to Simple on a stored value it does not know, and still switches with storage refused", async () => {
    const storage = memoryStorage();
    storage.setItem(VIEW_KEY, "fancy");
    const odd = await open(walk([]), { prefs: memoryPrefs(storage) });
    expect(odd.host.querySelector("main")?.dataset.view).toBe("simple");
    await odd.unmount();
    const refused = await open(walk([finding("a")]), { prefs: storagePrefs(refusingStorage) });
    await pick(refused.host, copy.results.detailed);
    expect(refused.host.querySelector("main")?.dataset.view).toBe("detailed");
    await refused.unmount();
  });
});

describe("status and green", () => {
  const RECHECK = { photo: "recheck.jpg", atMs: Date.UTC(2026, 10, 2, 12) };
  const marked = (status: Record<string, unknown>) => {
    const storage = memoryStorage();
    storage.setItem(marksKey("walk-1"), JSON.stringify({ removed: {}, status }));
    return memoryMarks(storage);
  };
  const required = finding("req", { ...feet(12) });
  const close = finding("close", { label: "recommended", band: "zone_0", ...feet(3) });
  const far = finding("far", { label: "recommended", band: "zone_2", ...feet(50) });
  const statuses = (host: HTMLElement) =>
    Object.fromEntries([...host.querySelectorAll("li.finding")].map((li) => [li.getAttribute("data-finding"), li.querySelector("[data-part=status]")?.getAttribute("data-status")]));

  it("needs every Required Now and every first five feet item Rechecked; Done alone and far Recommended items do not count", async () => {
    const results = walk([required, close, far]);
    const cases: [Record<string, unknown>, string][] = [
      [{}, copy.results.fixFirst(2)],
      [{ req: { kind: "done" }, close: { kind: "done" } }, copy.results.fixFirst(2)],
      [{ req: { kind: "fix_planned", recheck: RECHECK }, close: { kind: "done", recheck: RECHECK } }, copy.results.fixFirst(1)],
      [{ req: { kind: "done", recheck: RECHECK } }, copy.results.fixFirst(1)],
      [{ req: { kind: "done", recheck: RECHECK }, close: { kind: "done", recheck: RECHECK } }, copy.results.ready],
    ];
    for (const [status, heading] of cases) {
      const view = await open(results, { marks: marked(status) });
      expect(view.h1(), JSON.stringify(status)).toBe(heading);
      await view.unmount();
    }
  });

  it("never shows green on an incomplete walk, every item Rechecked", async () => {
    const view = await open(walk([required], [GAP]), { marks: marked({ req: { kind: "done", recheck: RECHECK } }) });
    expect(view.h1()).toBe(copy.results.incomplete);
    await view.unmount();
  });

  it("shows each row's status at a glance in both views, Rechecked with its date and Done as not rechecked yet", async () => {
    const view = await open(walk([required, close, far]), {
      marks: marked({ req: { kind: "done", recheck: RECHECK }, close: { kind: "done" }, far: { kind: "fix_planned", note: "crew" } }),
    });
    for (const chosen of [copy.results.simple, copy.results.detailed]) {
      await pick(view.host, chosen);
      expect(statuses(view.host)).toEqual({ req: "rechecked", close: "done", far: "fix_planned" });
      const row = (id: string) => view.host.querySelector(`li.finding[data-finding=${id}] [data-part=status]`)!;
      expect([...row("req").querySelectorAll("p")].map((p) => p.textContent)).toEqual([copy.status.rechecked, longDate(new Date(RECHECK.atMs))]);
      expect(row("req").querySelector("time")?.getAttribute("datetime")).toBe(new Date(RECHECK.atMs).toISOString());
      expect([...row("close").querySelectorAll("p")].map((p) => p.textContent)).toEqual([copy.status.kind.done, copy.status.notRechecked]);
      expect([...row("far").querySelectorAll("p")].map((p) => p.textContent)).toEqual([copy.status.kind.fix_planned]);
    }
    await view.unmount();
  });

  it("shows Needs Fixing on every row of a walk nobody has marked", async () => {
    const view = await open(walk([required, far]));
    expect(statuses(view.host)).toEqual({ req: "needs_fixing", far: "needs_fixing" });
    expect(view.text()).not.toContain(copy.status.rechecked);
    await view.unmount();
  });
});

describe("the sample house", () => {
  it("opens from its own results", async () => {
    const sample = SAMPLES[0]!;
    const view = await open(sample);
    expect(view.h1()).toBe(copy.results.incomplete);
    expect(view.text()).toContain(copy.results.sample);
    expect(view.host.querySelectorAll("li.finding")).toHaveLength(sample.findings.length);
    await view.unmount();
  });
});
