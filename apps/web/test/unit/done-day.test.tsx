import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, draft } from "../../src/copy.ts";
import { fixedApi } from "../../src/fixed-api.ts";
import { storageMarkSync } from "../../src/mark-sync.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { fakeClock, memoryMarks, memoryStorage, testDeps } from "./fakes.ts";
import { standIn, standInFetch, WALK } from "./fixed-fakes.ts";
import type { StandIn } from "./fixed-fakes.ts";
import { callsTo, find, has, lines, RESULTS, tap, typeInto, until } from "./fixed-screen.tsx";
import { render, settle } from "./render.ts";
import { liveFindingId } from "./result-fakes.ts";

afterEach(() => {
  window.location.hash = "";
});

const FINDING = liveFindingId(1);
const NOON_UTC = Date.UTC(2026, 9, 29, 19);
const TODAY = "2026-10-29";
const STATUS = `/api/findings/${FINDING}/status`;

const world = (state: StandIn = standIn()) => {
  const storage = memoryStorage();
  const fixed = fixedApi("https://ember.test", standInFetch(state), () => "v");
  const sync = storageMarkSync(() => memoryStorage(), fixed.mark);
  return { state, storage, fixed, sync };
};

const openFinding = async (w: ReturnType<typeof world>, resultsId = WALK, findingId = FINDING, results = RESULTS, now = NOON_UTC) => {
  window.location.hash = findingFor(resultsId, findingId);
  const deps = testDeps({
    fixed: w.fixed,
    sync: w.sync,
    clock: fakeClock(now).clock,
    marks: memoryMarks(w.storage),
    results: async (id) => (id === results.id ? results : null),
  });
  const view = await render(<App deps={deps} />);
  await until(() => view.host.querySelector("main.one-finding") !== null);
  return { ...view, deps };
};

const dayField = (host: HTMLElement) => find<HTMLInputElement>(host, "#done-day");

const kind = (host: HTMLElement) => host.querySelector(".status-picker [data-part=status]")?.getAttribute("data-status");

describe("choosing Done asks for the day it was done", () => {
  it("opens a date field set to today, saves nothing yet, then saves the day on Save and posts it", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    expect(dayField(view.host).type).toBe("date");
    expect(dayField(view.host).value).toBe(TODAY);
    expect(view.host.querySelector("label[for=done-day]")?.textContent).toBe(draft.status.doneDay);
    expect(kind(view.host)).toBe("needs_fixing");
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(0);
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    expect(callsTo(w.state, "POST", STATUS)[0]?.body).toEqual({ status: "done", doneOn: TODAY });
    expect(kind(view.host)).toBe("done");
    expect(lines(view.host, ".status-picker [data-part=done-on]")).toEqual(["Done on Oct. 29th, 2026."]);
    expect(view.host.querySelector("#done-day")).toBeNull();
    expect(w.sync.waiting()).toBe(0);
    await view.unmount();
  });

  it("posts the day the homeowner picked, and shows it again on the list and after reopening", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await typeInto(dayField(view.host), "2026-10-26");
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    expect(callsTo(w.state, "POST", STATUS)[0]?.body).toEqual({ status: "done", doneOn: "2026-10-26" });
    await view.unmount();
    const again = await openFinding(w);
    expect(lines(again.host, ".status-picker [data-part=done-on]")).toEqual(["Done on Oct. 26th, 2026."]);
    await settle(() => {
      window.location.hash = resultsFor(WALK);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await until(() => again.host.querySelector("li.finding [data-part=done-on]") !== null);
    expect(lines(again.host, "li.finding [data-part=done-on]")[0]).toBe("Done on Oct. 26th, 2026.");
    await again.unmount();
  });

  it("saves nothing without a day", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await typeInto(dayField(view.host), "");
    await tap(view.host, copy.status.save);
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(0);
    expect(kind(view.host)).toBe("needs_fixing");
    expect(view.host.querySelector("#done-day")).not.toBeNull();
    await view.unmount();
  });

  it("does not let the day be after today", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    expect(dayField(view.host).max).toBe(TODAY);
    await view.unmount();
  });

  it("closes the day field when another status is chosen", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.kind.needs_fixing);
    expect(view.host.querySelector("#done-day")).toBeNull();
    await view.unmount();
  });
});

describe("every mark on a live walk is posted to EmberWalk", () => {
  it("posts Fix Planned with its note, and without a note when there is none, and Needs Fixing", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.fix_planned);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    await typeInto(find<HTMLInputElement>(view.host, "#note"), "  Tree crew coming Saturday.  ");
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 2);
    await tap(view.host, copy.status.kind.needs_fixing);
    await until(() => callsTo(w.state, "POST", STATUS).length === 3);
    expect(callsTo(w.state, "POST", STATUS).map((c) => c.body)).toEqual([
      { status: "fix_planned" },
      { status: "fix_planned", note: "Tree crew coming Saturday." },
      { status: "needs_fixing" },
    ]);
    await view.unmount();
  });

  it("keeps a sample walk's marks on the phone and posts none", async () => {
    const sample = SAMPLES[0]!;
    const w = world();
    const view = await openFinding(w, sample.id, sample.findings[0]!.id, sample);
    await tap(view.host, copy.status.kind.fix_planned);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    expect(kind(view.host)).toBe("done");
    expect(w.state.calls.filter((c) => c.path.includes("/status"))).toEqual([]);
    expect(view.text()).not.toContain(draft.status.willSave);
    await view.unmount();
  });
});

describe("a mark made with no signal", () => {
  const offlineDone = async (w: ReturnType<typeof world>) => {
    const view = await openFinding(w);
    w.state.offline = true;
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await until(() => view.text().includes(draft.status.willSave));
    return view;
  };

  it("stays marked on the phone and says it will be saved when signal returns", async () => {
    const w = world();
    const view = await offlineDone(w);
    expect(kind(view.host)).toBe("done");
    expect(w.sync.waiting()).toBe(1);
    expect(memoryMarks(w.storage).statusOf(WALK, FINDING)).toMatchObject({ kind: "done", doneOn: TODAY });
    await view.unmount();
  });

  it("is posted on the next mark, before it and in order, and the line goes", async () => {
    const w = world();
    const view = await offlineDone(w);
    w.state.offline = false;
    await tap(view.host, copy.status.kind.fix_planned);
    await until(() => !view.text().includes(draft.status.willSave));
    expect(callsTo(w.state, "POST", STATUS).map((c) => c.body)).toEqual([{ status: "done", doneOn: TODAY }, { status: "fix_planned" }]);
    expect(w.sync.waiting()).toBe(0);
    await view.unmount();
  });

  it("is posted when the screen is opened again with signal, and the line is not shown", async () => {
    const w = world();
    const first = await offlineDone(w);
    await first.unmount();
    w.state.offline = false;
    const again = await openFinding(w);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    expect(callsTo(w.state, "POST", STATUS)[0]?.body).toEqual({ status: "done", doneOn: TODAY });
    expect(again.text()).not.toContain(draft.status.willSave);
    expect(w.sync.waiting()).toBe(0);
    await again.unmount();
  });

  it("keeps the line while signal is still missing when the screen is opened again", async () => {
    const w = world();
    const first = await offlineDone(w);
    await first.unmount();
    const again = await openFinding(w);
    await until(() => again.text().includes(draft.status.willSave));
    expect(has(again.host, copy.status.kind.done)).toBe(true);
    await again.unmount();
  });
});

describe("the day Done is saved for", () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("is the phone's own day, not the UTC day, when the two differ", async () => {
    const w = world();
    const earlyUtc = Date.UTC(2026, 9, 29, 6, 30);
    const view = await openFinding(w, WALK, FINDING, RESULTS, earlyUtc);
    await tap(view.host, copy.status.kind.done);
    expect(dayField(view.host).value).toBe("2026-10-28");
    expect(dayField(view.host).max).toBe("2026-10-28");
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    expect(callsTo(w.state, "POST", STATUS)[0]?.body).toEqual({ status: "done", doneOn: "2026-10-28" });
    await view.unmount();
  });
});

describe("a day after today", () => {
  it("is refused on Save: nothing is marked or posted, and a line says why", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await typeInto(dayField(view.host), "2026-10-30");
    await tap(view.host, copy.status.save);
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(0);
    expect(kind(view.host)).toBe("needs_fixing");
    expect(lines(view.host, ".status-picker [role=status]")).toEqual([draft.status.futureDay]);
    expect(memoryMarks(w.storage).statusOf(WALK, FINDING).kind).toBe("needs_fixing");
    await typeInto(dayField(view.host), TODAY);
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    expect(view.host.querySelector(".status-picker [role=status]")).toBeNull();
    await view.unmount();
  });
});

describe("a mark that changes nothing", () => {
  it("is not posted again: the same day Done, Needs Fixing when it already is, and the same note", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.needs_fixing);
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(0);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 1);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(1);
    await view.unmount();
  });

  it("is posted when the day is changed", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await tap(view.host, copy.status.kind.done);
    await typeInto(dayField(view.host), "2026-10-25");
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 2);
    expect(callsTo(w.state, "POST", STATUS).map((c) => c.body)).toEqual([
      { status: "done", doneOn: TODAY },
      { status: "done", doneOn: "2026-10-25" },
    ]);
    await view.unmount();
  });

  it("is not posted twice for the same note on Fix Planned", async () => {
    const w = world();
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.fix_planned);
    await typeInto(find<HTMLInputElement>(view.host, "#note"), "Crew Saturday.");
    await tap(view.host, copy.status.save);
    await until(() => callsTo(w.state, "POST", STATUS).length === 2);
    await tap(view.host, copy.status.save);
    await tap(view.host, copy.status.kind.fix_planned);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(callsTo(w.state, "POST", STATUS)).toHaveLength(2);
    await view.unmount();
  });
});

describe("a mark the server refuses", () => {
  it("stays marked on the phone and says it could not be saved to the record, not that it is waiting", async () => {
    const w = world(standIn({ markRefused: true }));
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await until(() => view.text().includes(draft.status.refused));
    expect(kind(view.host)).toBe("done");
    expect(view.text()).not.toContain(draft.status.willSave);
    expect(w.sync.waiting()).toBe(0);
    await view.unmount();
  });

  it("says so when a mark made without signal is refused once the screen is opened with signal", async () => {
    const w = world();
    const first = await openFinding(w);
    w.state.offline = true;
    await tap(first.host, copy.status.kind.done);
    await tap(first.host, copy.status.save);
    await until(() => first.text().includes(draft.status.willSave));
    await first.unmount();
    w.state.offline = false;
    w.state.markRefused = true;
    const again = await openFinding(w);
    await until(() => again.text().includes(draft.status.refused));
    expect(again.text()).not.toContain(draft.status.willSave);
    await again.unmount();
  });

  it("does not block the marks made after it", async () => {
    const w = world(standIn({ markRefused: true }));
    const view = await openFinding(w);
    await tap(view.host, copy.status.kind.done);
    await tap(view.host, copy.status.save);
    await until(() => view.text().includes(draft.status.refused));
    w.state.markRefused = false;
    await tap(view.host, copy.status.kind.fix_planned);
    await until(() => !view.text().includes(draft.status.refused));
    expect(callsTo(w.state, "POST", STATUS).map((c) => c.body).at(-1)).toEqual({ status: "fix_planned" });
    await view.unmount();
  });
});
