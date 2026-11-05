import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, draft } from "../../src/copy.ts";
import { demoFixed, withDemo } from "../../src/demo-fixed.ts";
import type { Deps } from "../../src/deps.ts";
import { fixFor, mapFor, resultsFor, ROUTES, routeFor } from "../../src/router.ts";
import { SAMPLES, withStills } from "../../src/samples.ts";
import { testDeps } from "./fakes.ts";
import { jobsView, standIn, WALK } from "./fixed-fakes.ts";
import { find, has, mount, tap, typeInto, until } from "./fixed-screen.tsx";
import { render } from "./render.ts";
import { feet, finding, pin, walk } from "./result-fakes.ts";

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

const near = finding("near", { band: "zone_0", ...feet(2), instruction: "Move the near thing." });
const mid = finding("mid", { band: "zone_1", ...feet(12), instruction: "Clear the middle thing." });
const far = finding("far", { band: "zone_2", ...feet(60), label: "recommended", instruction: "Thin the far thing." });
const PINNED = walk([far, mid, near], [], { pins: [pin("near", { band: "zone_0", feet: 2 }), pin("mid", { feet: 12 }), pin("far", { band: "zone_2", feet: 60 })] });

const open = async (hash: string, results: typeof PINNED, over: Partial<Deps> = {}) => {
  window.location.hash = hash;
  const deps = testDeps({ results: async (id) => (id === results.id ? results : null), ...over });
  const view = await render(<App deps={deps} />);
  await until(() => view.host.querySelector("main.results, main.map-screen") !== null);
  return { ...view, deps };
};

describe("the house map route", () => {
  it("opens a map only for a walk named in the address", () => {
    expect(routeFor(mapFor("walk-1"))).toBe("map");
    expect(routeFor(ROUTES.map)).toBe("home");
  });

  it("opens from the one Map button on Simple, which draws no map of its own", async () => {
    const view = await open(resultsFor(PINNED.id), PINNED);
    expect(view.host.querySelector("main.results figure.house-map")).toBeNull();
    const button = find<HTMLAnchorElement>(view.host, "a[data-part='map']");
    expect(button.textContent).toBe(copy.map.button);
    expect(button.getAttribute("href")).toBe(mapFor(PINNED.id));
    await view.unmount();
  });

  it("draws the map in full on Detailed, with no Map button", async () => {
    const view = await open(resultsFor(PINNED.id), PINNED);
    await tap(view.host, copy.results.detailed);
    expect(view.host.querySelector("main.results figure.house-map")).not.toBeNull();
    expect(view.host.querySelector("a[data-part='map']")).toBeNull();
    await view.unmount();
  });

  it("gives a walk with no findings no Map button", async () => {
    const view = await open(resultsFor(PINNED.id), walk([]));
    expect(view.host.querySelector("a[data-part='map']")).toBeNull();
    await view.unmount();
  });

  it("puts Fix These First above the pins, and each row's number on its pin", async () => {
    const view = await open(mapFor(PINNED.id), PINNED);
    const main = find(view.host, "main.map-screen");
    const top = find(main, "section.fix-first");
    const map = find(main, "figure.house-map");
    expect(top.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(find(top, "h2").textContent).toBe(copy.results.fixFirst(2));
    expect([...top.querySelectorAll("li a")].map((a) => a.textContent)).toEqual(["1. Move the near thing.", "2. Clear the middle thing."]);
    const numbered = [...map.querySelectorAll("a.pin")].map((a) => [a.getAttribute("data-finding"), a.querySelector("text")?.textContent]);
    expect(numbered).toEqual([["near", "1"], ["mid", "2"], ["far", "3"]]);
    await view.unmount();
  });

  it("leaves a finding it has already seen rechecked off the top list", async () => {
    const view = await open(mapFor(PINNED.id), PINNED);
    view.deps.marks.setStatus(PINNED.id, "near", "done");
    view.deps.marks.setRecheck(PINNED.id, "near", { photo: "p", atMs: 1, result: "cleared" });
    await view.unmount();
    const again = await open(mapFor(PINNED.id), PINNED, { marks: view.deps.marks });
    expect(find(again.host, "section.fix-first h2").textContent).toBe(copy.results.fixFirst(1));
    await again.unmount();
  });

  it("says why instead of drawing an empty map when nothing can be placed", async () => {
    const view = await open(mapFor(PINNED.id), walk([near, mid]));
    expect(view.host.querySelector("figure.house-map")).toBeNull();
    expect(view.text()).toContain(copy.map.noPins);
    expect(view.text()).toContain("Move the near thing.");
    await view.unmount();
  });

  it("says when only some things could be placed", async () => {
    const view = await open(mapFor(PINNED.id), walk([near, mid], [], { pins: [pin("near", { band: "zone_0", feet: 2 })] }));
    expect(view.host.querySelectorAll("a.pin")).toHaveLength(1);
    expect(view.text()).toContain(copy.map.somePlaced);
    await view.unmount();
  });
});

describe("the results of an incomplete walk", () => {
  it("still lists what to fix first", async () => {
    const results = walk([far, near], [{ side: "left", kind: "missing", hint: "walk_side" }]);
    const view = await open(resultsFor(results.id), results);
    expect(find(view.host, "h1").textContent).toBe(copy.results.incomplete);
    expect(find(view.host, "section.so-far h3").textContent).toBe(copy.results.fixFirst(1));
    await view.unmount();
  });
});

describe("the bundled sample until the final walk comes", () => {
  const sample = SAMPLES[0]!;

  it("never says the missing sides are in the visitor's video, and says plainly it is partly walked", async () => {
    const view = await open(resultsFor(sample.id), sample);
    expect(find(view.host, "h1").textContent).toBe(copy.sample.partial);
    expect(view.text()).toContain(copy.sample.partialLine);
    expect(view.text()).not.toContain("your video");
    expect(view.text()).toContain(copy.results.fixFirst(1));
    await view.unmount();
  });

  it("shows only the finding it holds, on one pin from where the scene puts it", async () => {
    const view = await open(mapFor(sample.id), sample);
    expect(sample.pins).toEqual([{ findingId: "wood-pile-1", side: "back", band: "zone_0", position: 0.25, feet: 0 }]);
    expect(view.host.querySelectorAll("a.pin")).toHaveLength(1);
    expect(view.text()).toContain(copy.sample.label);
    await view.unmount();
  });

  it("carries no sample label on a real walk's map", async () => {
    const view = await open(mapFor(PINNED.id), PINNED);
    expect(view.text()).not.toContain(copy.sample.label);
    await view.unmount();
  });

  it("says nothing about sides when nothing could be placed, since a far thing's side may be known", () => {
    expect(copy.map.noPins).not.toMatch(/side/);
  });

  it("opens the full Fix These First list and all its pins once a whole walk replaces it", async () => {
    const whole = { ...sample, gaps: [], findings: [near, mid, far], pins: PINNED.pins! };
    const view = await open(resultsFor(sample.id), whole);
    expect(find(view.host, "h1").textContent).toBe(copy.results.fixFirst(2));
    await view.unmount();
    const map = await open(mapFor(sample.id), whole);
    expect(map.host.querySelectorAll("a.pin")).toHaveLength(3);
    await map.unmount();
  });
});

describe("the stills of a real run in the sample", () => {
  const live = finding("f-1", { proof: { still: "/api/walks/w/stills/f-1", frame: 1, seconds: 1, marker: [0.1, 0.1, 0.2, 0.2] } });

  it("takes each still and preview the run wrote for its finding, by the name the run gave it", () => {
    const [shown] = withStills(walk([live]), { "3-f-1.jpg": "/a.jpg", "3-f-1-preview.jpg": "/b.jpg" }).findings;
    expect(shown!.proof.still).toBe("/a.jpg");
    expect(shown!.preview).toBe("/b.jpg");
  });

  it("does not stop the app when a still is missing", () => {
    expect(withStills(walk([live]), {}).findings[0]!.proof.still).toBe(live.proof.still);
  });
});

describe("the crews screen", () => {
  it("opens with the draft switch off", async () => {
    window.location.hash = ROUTES.crews;
    const view = await render(<App deps={testDeps()} />);
    await until(() => view.host.querySelector("main.crew-signup") !== null);
    await view.unmount();
  });
});

describe("the sample's Defensible Space Record", () => {
  const sample = SAMPLES[0]!;
  const finding1 = sample.findings[0]!;
  const empty = { walks: [] };
  const real = (history: unknown) => ({ history: async () => history }) as never;

  const demo = (over: Partial<Deps> = {}) => {
    const deps = testDeps(over);
    const results = async (id: string) => (id === sample.id ? sample : null);
    return { deps, demo: demoFixed({ results, samples: [sample], marks: deps.marks, now: () => new Date("2026-11-01T12:00:00Z"), storage: window.localStorage }), results };
  };

  it("lists a mark made on the sample, beside the real walks", async () => {
    const { deps, demo: api, results } = demo();
    deps.marks.setStatus(sample.id, finding1.id, "done", "", "2026-10-30");
    const answer = await withDemo(real({ value: empty }), api, results).history();
    expect(answer).toMatchObject({ value: { walks: [{ walkId: sample.id, walkedOn: sample.walkedOn, marks: [{ findingId: finding1.id, concept: finding1.concept, status: "done", doneOn: "2026-10-30" }] }] } });
  });

  it("keeps the day a fix was planned", async () => {
    const { deps, demo: api } = demo();
    deps.marks.setStatus(sample.id, finding1.id, "fix_planned", "Saturday.", "2026-10-29");
    expect(deps.marks.statusOf(sample.id, finding1.id).doneOn).toBeUndefined();
    expect(await api.history()).toMatchObject({ value: { walks: [{ marks: [{ status: "fix_planned", note: "Saturday.", doneOn: "2026-10-29" }] }] } });
  });

  it("adds no sample walk with no marks, and shows the sample's marks when the server cannot be reached", async () => {
    const { deps, demo: api, results } = demo();
    expect(await withDemo(real({ value: empty }), api, results).history()).toEqual({ value: empty });
    expect(await withDemo(real({ code: "offline", message: "" }), api, results).history()).toEqual({ code: "offline", message: "" });
    deps.marks.setStatus(sample.id, finding1.id, "done", "", "2026-10-30");
    expect(await withDemo(real({ code: "offline", message: "" }), api, results).history()).toEqual({ code: "offline", message: "" });
    expect(await withDemo(real({ value: empty }), api, results).history()).toMatchObject({ value: { walks: [{ walkId: sample.id }] } });
  });

  it("says on the record that it is the sample house", async () => {
    const walks = [{ walkId: sample.id, walkedOn: sample.walkedOn, synthetic: true, state: "done", marks: [] }];
    const view = await mount(ROUTES.history, standIn(), { fixed: { history: async () => ({ value: { walks } }) } as never });
    await until(() => view.host.querySelector("section.record-walk") !== null);
    expect(view.text()).toContain(draft.history.sample);
    await view.unmount();
  });
});

describe("a ZIP code on Get It Fixed", () => {
  const typed = async (zip: string, state = standIn()) => {
    const view = await mount(fixFor(WALK), state);
    await until(() => view.host.querySelector("#zip") !== null);
    await typeInto(find<HTMLInputElement>(view.host, "#zip"), zip);
    await tap(view.host, draft.fixed.zipButton);
    return { view, state };
  };

  it("says plainly a ZIP outside California has no crews here, and plans nothing", async () => {
    const { view, state } = await typed("10001");
    await until(() => view.text().includes(draft.fixed.zipOutside("10001")));
    expect(view.text()).toContain(copy.record.location.outside);
    expect(state.view.jobs).toEqual([]);
    expect(view.host.querySelector("#zip")).not.toBeNull();
    await view.unmount();
  });

  it.each(["90001", "96162"])("plans for %s, inside California", async (zip) => {
    const { view } = await typed(zip);
    await until(() => view.host.querySelector("section.job") !== null);
    await view.unmount();
  });

  it("asks for the ZIP again when a plan found no crew for any job", async () => {
    const state = standIn({ planned: jobsView([{ ...standIn().planned.jobs[0]!, crews: [] }]) });
    const { view } = await typed("96161", state);
    await until(() => view.text().includes(draft.fixed.noCrews));
    expect(view.text()).toContain(draft.fixed.zipRetry);
    expect(view.host.querySelector("#zip")).not.toBeNull();
    await view.unmount();
  });

  it("does not ask again once any job holds a crew", async () => {
    const { view } = await typed("95370");
    await until(() => view.host.querySelector("section.job") !== null);
    expect(view.host.querySelector("#zip")).toBeNull();
    expect(has(view.host, draft.fixed.zipButton)).toBe(false);
    await view.unmount();
  });
});
