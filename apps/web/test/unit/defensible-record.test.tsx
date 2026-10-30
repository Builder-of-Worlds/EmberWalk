import { afterEach, describe, expect, it } from "vitest";
import { copy, draft } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";
import { K1, K2, K3, K4, standIn, uid, WALK } from "./fixed-fakes.ts";
import { find, has, lines, mount, tap, until } from "./fixed-screen.tsx";

afterEach(() => {
  window.location.hash = "";
});

const OLD_WALK = uid(0x91, 1);
const MID_WALK = uid(0x91, 2);

const mark = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  findingId: uid(0xf2, Number.parseInt(id.slice(-10), 16)),
  concept: "wood_pile",
  status: "needs_fixing",
  note: null,
  doneOn: null,
  markedAt: "2026-10-27T19:00:00.000Z",
  ...over,
});

const history = {
  walks: [
    { walkId: OLD_WALK, walkedOn: "2026-08-02", synthetic: false, state: "done", marks: [] },
    {
      walkId: WALK,
      walkedOn: "2026-10-27",
      synthetic: false,
      state: "done",
      marks: [
        mark(K1, { status: "done", doneOn: "2026-10-25", markedAt: "2026-10-28T19:00:00.000Z" }),
        mark(K2, { status: "fix_planned", concept: "dry_brush", note: "Crew coming Saturday.", markedAt: "2026-10-28T19:00:00.000Z" }),
        mark(K3, { status: "needs_fixing", concept: "roof_debris" }),
      ],
    },
    { walkId: MID_WALK, walkedOn: "2026-09-14", synthetic: true, state: "done", marks: [mark(K4, { status: "done", doneOn: "2026-09-20" })] },
  ],
} as never;

describe("Defensible Space Record", () => {
  it("titles the screen and lists the walks newest first, each by the day it was walked", async () => {
    const view = await mount(ROUTES.history, standIn({ history }));
    await until(() => view.host.querySelector("section.record-walk") !== null);
    expect(view.host.querySelector("h1")?.textContent).toBe("Defensible Space Record");
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.history.title);
    expect(lines(view.host, "section.record-walk h2")).toEqual([
      "Walked Tuesday, October 27th, 2026.",
      "Walked Monday, September 14th, 2026.",
      "Walked Sunday, August 2nd, 2026.",
    ]);
    expect([...view.host.querySelectorAll("section.record-walk")].map((s) => s.getAttribute("data-walk"))).toEqual([WALK, MID_WALK, OLD_WALK]);
    await view.unmount();
  });

  it("shows each mark with its status and its day: the day it was done for Done, the day it was marked otherwise", async () => {
    const view = await mount(ROUTES.history, standIn({ history }));
    await until(() => view.host.querySelector("li[data-mark]") !== null);
    const row = (id: string) => find(view.host, `[data-mark=${id}]`);
    expect(row(K1).textContent).toContain("Wood piles");
    expect(lines(row(K1), "[data-part=mark]")).toEqual(["Done on Oct. 25th, 2026"]);
    expect(lines(row(K2), "[data-part=mark]")).toEqual(["Fix Planned on Oct. 28th, 2026"]);
    expect(row(K2).textContent).toContain("Dry brush");
    expect(lines(row(K2), "q")).toEqual(["Crew coming Saturday."]);
    expect(lines(row(K3), "[data-part=mark]")).toEqual(["Needs Fixing on Oct. 27th, 2026"]);
    expect(row(K3).textContent).toContain("Leaves and needles on the roof");
    expect(lines(row(K4), "[data-part=mark]")).toEqual(["Done on Sept. 20th, 2026"]);
    expect(view.text()).toContain(draft.history.noMarks);
    await view.unmount();
  });

  it("says so when there are no walks yet", async () => {
    const view = await mount(ROUTES.history, standIn());
    await until(() => view.text().includes(draft.history.empty));
    expect(view.host.querySelector("section.record-walk")).toBeNull();
    await view.unmount();
  });

  it("says there is no signal and loads the record on Try Again", async () => {
    const state = standIn({ offline: true, history });
    const view = await mount(ROUTES.history, state);
    await until(() => has(view.host, draft.fixed.tryAgain));
    expect(view.text()).toContain(draft.fixed.problem("offline"));
    state.offline = false;
    await tap(view.host, draft.fixed.tryAgain);
    await until(() => view.host.querySelector("section.record-walk") !== null);
    await view.unmount();
  });

  it("opens from Home", async () => {
    const view = await mount(ROUTES.home, standIn({ history }));
    const link = find(view.host, `a[href="${ROUTES.history}"]`);
    expect(link.textContent).toBe(copy.history.title);
    await tap(view.host, copy.history.title, "a");
    await until(() => view.host.querySelector("main.history") !== null || window.location.hash === ROUTES.history);
    await view.unmount();
  });
});
