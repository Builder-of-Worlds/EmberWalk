import { afterEach, describe, expect, it } from "vitest";
import { walkApi } from "../../src/api.ts";
import { App } from "../../src/App.tsx";
import { GAP_HINTS, SIDES } from "@emberwalk/shared";
import { copy, draft, longDate, unbacked } from "../../src/copy.ts";
import { feetSaid } from "../../src/distance.ts";
import { apiResults, samplesThenApi } from "../../src/live-api.ts";
import { marksKey } from "../../src/finding-marks.ts";
import { storagePrefs, VIEW_KEY } from "../../src/prefs.ts";
import type { WalkResults } from "../../src/results.ts";
import { recordPartFor, resultsFor, ROUTES, WALK_START } from "../../src/router.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { fakeClock, memoryMarks, memoryPrefs, memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, LIVE_WALK, liveBody, liveFindingId, walk } from "./result-fakes.ts";
import { NEVER_LABELLED, NEVER_SAID, SETTLED_GAPS, SETTLED_HINTS, SETTLED_NOT_CHECKED, SETTLED_RESULTS, SETTLED_SIDE, SETTLED_STATUS, shownLines } from "./settled.ts";

const FIVE_FEET_LINE = "Start here: closest to your home. We're looking inside the first 5 feet.";

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

const GAP = { side: "back", kind: "missing", hint: "walk_side" } as const;

const buttons = (host: HTMLElement) => [...host.querySelectorAll("a.button.primary")].map((a) => [a.textContent, a.getAttribute("href")]);

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
    const view = await open(walk([finding("a")], [GAP, { side: "left", kind: "dark", hint: "more_light" }, { side: "right", kind: "first_five_feet", hint: "tilt_down" }]));
    expect(view.h1()).toBe(copy.results.incomplete);
    expect([...view.host.querySelectorAll("ul.lines li > span")].map((span) => span.textContent)).toEqual(SETTLED_GAPS);
    expect(view.host.querySelector("main")?.dataset.verdict).toBe("incomplete");
    expect(view.host.querySelector(".green")).toBeNull();
    for (const line of [copy.results.ready, copy.results.allClear, copy.results.insurance, FIVE_FEET_LINE]) expect(view.text()).not.toContain(line);
    expect(view.host.querySelector("h2")?.textContent).toBe(copy.results.soFar);
    expect([...view.host.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([copy.results.bands.zone_1]);
    expect(view.host.querySelectorAll("li.finding")).toHaveLength(1);
    await view.unmount();
  });

  it("asks for the one side the walk could not check, never the whole walk", async () => {
    const view = await open(walk([finding("a")], [{ side: "back", kind: "not_checked", hint: "again" }], { id: LIVE_WALK }));
    expect(view.h1()).toBe(copy.results.incomplete);
    expect([...view.host.querySelectorAll("ul.lines li > span")].map((span) => span.textContent)).toEqual([SETTLED_SIDE.notChecked]);
    expect(buttons(view.host)).toEqual([[SETTLED_SIDE.walk.back, recordPartFor(LIVE_WALK, "back")]]);
    expect(view.text()).not.toContain(copy.results.walkAgain);
    await view.unmount();
  });

  it("gives one button per gapped side, in walking order, however many gaps a side has", async () => {
    const gaps = [{ side: "left", kind: "dark", hint: "more_light" }, GAP, { side: "back", kind: "first_five_feet", hint: "step_back" }] as const;
    const view = await open(walk([], [...gaps], { id: LIVE_WALK }));
    expect(buttons(view.host)).toEqual([
      [SETTLED_SIDE.walk.back, recordPartFor(LIVE_WALK, "back")],
      [SETTLED_SIDE.walk.left, recordPartFor(LIVE_WALK, "left")],
    ]);
    await view.unmount();
  });

  it("shows no side button on a walk with no gap", async () => {
    const view = await open(walk([finding("a")]));
    expect(buttons(view.host)).toEqual([]);
    await view.unmount();
  });

  it("offers Walk Again only when every side is gapped, and no button at all on a sample house", async () => {
    const everySide = SIDES.map((side) => ({ side, kind: "missing", hint: "walk_side" }) as const);
    const own = await open(walk([], everySide));
    expect(buttons(own.host)).toEqual([[copy.results.walkAgain, ROUTES.how]]);
    expect(own.text()).not.toContain(copy.results.soFar);
    await own.unmount();
    const prefs = memoryPrefs();
    prefs.markIntroSeen();
    const seen = await open(walk([], everySide), { prefs });
    expect(buttons(seen.host)).toEqual([[copy.results.walkAgain, WALK_START]]);
    await seen.unmount();
    for (const gaps of [everySide, [GAP]]) {
      const sample = await open(walk([], gaps, { synthetic: true }));
      expect(buttons(sample.host)).toEqual([]);
      await sample.unmount();
    }
  });

  it("says under each gap how to reshoot that side, in the words Deacon approved (D-181)", async () => {
    const gaps = [
      { side: "back", kind: "missing", hint: "walk_side" },
      { side: "back", kind: "dark", hint: "more_light" },
      { side: "back", kind: "first_five_feet", hint: "tilt_down" },
      { side: "left", kind: "first_five_feet", hint: "step_back" },
      { side: "left", kind: "not_checked", hint: "again" },
    ] as const;
    const view = await open(walk([], [...gaps], { id: LIVE_WALK }));
    expect(Object.keys(copy.results.hint).sort()).toEqual([...GAP_HINTS].sort());
    const said = [...view.host.querySelectorAll("ul.lines li")].map((li) => [li.querySelector("span")?.textContent, li.querySelector("p.hint")?.textContent]);
    expect(said).toEqual(gaps.map((gap) => [copy.results.gap(gap), copy.results.hint[gap.hint](gap.side)]));
    expect(said.slice(0, 3).map(([, hint]) => hint)).toEqual([SETTLED_HINTS.walk_side, SETTLED_HINTS.more_light, SETTLED_HINTS.tilt_down]);
    expect(copy.results.hint.step_back("back")).toBe(SETTLED_HINTS.step_back);
    expect(copy.results.hint.again("back")).toBe(SETTLED_HINTS.again);
    expect(buttons(view.host)).toEqual([
      [SETTLED_SIDE.walk.back, recordPartFor(LIVE_WALK, "back")],
      [SETTLED_SIDE.walk.left, recordPartFor(LIVE_WALK, "left")],
    ]);
    await view.unmount();
  });

  it("keeps the reshoot suggestions with Walk Again when every side is gapped, and off a sample house", async () => {
    const everySide = SIDES.map((side) => ({ side, kind: "dark", hint: "more_light" }) as const);
    const own = await open(walk([], everySide));
    expect([...own.host.querySelectorAll("p.hint")].map((p) => p.textContent)).toEqual(SIDES.map((side) => copy.results.hint.more_light(side)));
    await own.unmount();
    const sample = await open(walk([], everySide, { synthetic: true }));
    expect(sample.host.querySelectorAll("ul.lines li")).toHaveLength(4);
    expect(sample.host.querySelector("p.hint")).toBeNull();
    for (const side of SIDES) expect(sample.text()).not.toContain(copy.results.hint.more_light(side));
    await sample.unmount();
  });

  it("counts the items to fix first in its heading, nearest first under 30 feet whatever the label", async () => {
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
    const first = view.host.querySelector("main > ul.findings")!;
    expect([...first.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["rec-near", "req-near", "req-mid"]);
    const bands = [...view.host.querySelectorAll("section.band")].map((s) => [s.querySelector("h2")?.textContent, [...s.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))]);
    expect(bands).toEqual([
      ["First 5 Feet", ["rec-near"]],
      ["5 to 30 Feet", ["req-near", "req-mid"]],
      ["30 to 100 Feet", ["req-far"]],
    ]);
    await view.unmount();
  });

  it("never says the list stops at 5 feet, and puts no line above it until a new one is ruled", async () => {
    const list = [finding("rec-near", { label: "recommended", band: "zone_0", ...feet(1) }), finding("req-far", feet(25, 28))];
    const view = await open(walk(list));
    expect(view.h1()).toBe("Fix These 2 First");
    expect([...view.host.querySelectorAll("main > ul.findings li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["rec-near", "req-far"]);
    expect(view.text()).not.toContain(FIVE_FEET_LINE);
    expect(view.text()).not.toContain("first 5 feet");
    expect(view.host.querySelector("main > p.lead")).toBeNull();
    expect(Object.values(copy.results)).not.toContain(FIVE_FEET_LINE);
    await view.unmount();
  });

  it("keeps every drafted distance and count line off screen in both views until Deacon rules", async () => {
    const list = [
      finding("against", { band: "zone_0", ...feet(0) }),
      finding("within", { band: "zone_0", ...feet(0, 3) }),
      finding("about", feet(12)),
      finding("range", { label: "recommended", ...feet(12, 19) }),
    ];
    const lines = [
      unbacked.results.lead,
      ...list.map((f) => unbacked.results.distance(feetSaid(f.distanceFeet))),
      ...[0, 1, 2, 3, 4].flatMap((n) => [unbacked.results.inside(n), unbacked.results.out(n)]),
    ];
    expect(Object.keys(unbacked.results)).toEqual(["lead", "distance", "inside", "out"]);
    const view = await open(walk(list));
    for (const chosen of [copy.results.simple, copy.results.detailed]) {
      await pick(view.host, chosen);
      for (const line of lines) expect(view.text(), line).not.toContain(line);
      expect(view.host.querySelector("[data-part=distance]")).toBeNull();
    }
    await view.unmount();
  });

  it("shows no list for a walk whose findings are all Recommended past 30 feet, the bands as today", async () => {
    const view = await open(walk([finding("rec-40", { label: "recommended", band: "zone_2", ...feet(40) }), finding("rec-31", { label: "recommended", ...feet(31) })]));
    expect(view.h1()).toBe(copy.results.ready);
    expect(view.host.querySelector("main > ul.findings")).toBeNull();
    const bands = [...view.host.querySelectorAll("section.band")].map((s) => [s.querySelector("h2")?.textContent, [...s.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))]);
    expect(bands).toEqual([
      ["5 to 30 Feet", ["rec-31"]],
      ["30 to 100 Feet", ["rec-40"]],
    ]);
    await view.unmount();
  });

  it("lists a Required Now finding past 30 feet when nothing nearer is open, so the heading never counts zero", async () => {
    const view = await open(walk([finding("req-40", { band: "zone_2", ...feet(40) }), finding("rec-50", { label: "recommended", band: "zone_2", ...feet(50) })]));
    expect(view.h1()).toBe("Fix This First");
    expect([...view.host.querySelectorAll("main > ul.findings li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["req-40"]);
    await view.unmount();
  });

  it("shows a synthetic walk the same list, labelled as today", async () => {
    const list = [finding("at-28", { label: "recommended", ...feet(28, 40) }), finding("at-2", feet(2, 3)), finding("at-12", feet(12, 14))];
    const ids = async (synthetic: boolean) => {
      const view = await open(walk(list, [], { synthetic }));
      const rows = [...view.host.querySelectorAll("main > ul.findings li.finding")].map((li) => [li.getAttribute("data-finding"), li.querySelector("[data-part=label]")?.textContent]);
      await view.unmount();
      return rows;
    };
    const live = await ids(false);
    expect(live).toEqual([
      ["at-2", copy.results.label.required_now],
      ["at-12", copy.results.label.required_now],
      ["at-28", copy.results.label.recommended],
    ]);
    expect(await ids(true)).toEqual(live);
  });

  it("shows green with its date and the insurance line only when nothing blocks it", async () => {
    const view = await open(walk([finding("far", { label: "recommended", band: "zone_2", ...feet(40) })]));
    expect(view.h1()).toBe(copy.results.ready);
    expect(view.host.querySelector(".green")?.textContent).toBe(copy.results.allClear);
    expect(view.text()).toContain(copy.results.insurance);
    expect(view.text()).toContain("Walked Monday, October 26th, 2026.");
    expect(view.text()).not.toContain(FIVE_FEET_LINE);
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
        for (const line of shownLines(view.host)) expect([...SETTLED_RESULTS, ...SETTLED_STATUS, SETTLED_NOT_CHECKED.roof_debris, far.instruction, ...far.sources.map((s) => s.citation), copy.results.walked(new Date(Date.UTC(2026, 9, 26, 12)))], line).toContain(line);
      }
      expect(view.host.querySelectorAll("li.finding")).toHaveLength(findings.length);
      await view.unmount();
    }
  });

  it("opens a walk from the API with its findings, and never labels it synthetic, whatever the API says", async () => {
    for (const synthetic of [false, true]) {
      const body = liveBody(LIVE_WALK, 2, { synthetic });
      const walks = walkApi("https://ember.test", async () => Response.json(body), () => "c".repeat(64));
      const view = await open({ ...walk([]), id: LIVE_WALK }, { results: samplesThenApi(sampleResults, apiResults(walks, "https://ember.test")) });
      expect(view.h1()).toBe(copy.results.soFar);
      expect([...view.host.querySelectorAll("li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual([liveFindingId(1), liveFindingId(2)]);
      expect(view.text(), `synthetic ${synthetic}`).not.toMatch(NEVER_LABELLED);
      await view.unmount();
    }
  });

  it("says each concept the walk did not check, one line each under the heading, in order", async () => {
    const view = await open(walk([], [], { coverage: "not_checked", notChecked: ["roof_debris", "wood_pile"] }));
    expect([...view.host.querySelectorAll("main > ul.not-checked li")].map((li) => li.textContent)).toEqual([SETTLED_NOT_CHECKED.roof_debris, SETTLED_NOT_CHECKED.wood_pile]);
    expect(view.host.querySelector("main > h1 ~ ul.not-checked")).not.toBeNull();
    await view.unmount();
  });

  it("shows no not checked lines on a walk that names none", async () => {
    const view = await open(walk([], [], { coverage: "not_checked", notChecked: [] }));
    expect(view.host.querySelector("ul.not-checked")).toBeNull();
    expect(view.text()).not.toContain("Not checked");
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

  it("labels no house synthetic, a sample house or a walk of your own (D-177)", async () => {
    for (const synthetic of [true, false]) {
      const view = await open(walk([], [], { synthetic }));
      expect(view.host.querySelector("h1 + p")?.textContent).toBe(copy.results.walked(new Date(Date.UTC(2026, 9, 26, 12))));
      expect(view.text()).not.toMatch(NEVER_LABELLED);
      await view.unmount();
    }
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

  it("drops a Rechecked finding from the fix first list and its count, and keeps it in its band", async () => {
    const near = finding("near", { label: "recommended", ...feet(8) });
    const view = await open(walk([required, close, near]), { marks: marked({ close: { kind: "done", recheck: RECHECK } }) });
    expect(view.h1()).toBe(copy.results.fixFirst(2));
    expect([...view.host.querySelectorAll("main > ul.findings li.finding")].map((li) => li.getAttribute("data-finding"))).toEqual(["near", "req"]);
    expect(view.host.querySelector("section.band[data-band=zone_0] li.finding[data-finding=close]")).not.toBeNull();
    await view.unmount();
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
    expect(view.text()).not.toMatch(NEVER_LABELLED);
    expect(view.host.querySelectorAll("li.finding")).toHaveLength(sample.findings.length);
    await view.unmount();
  });
});
