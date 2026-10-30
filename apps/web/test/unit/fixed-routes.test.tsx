import { afterEach, describe, expect, it } from "vitest";
import { copy, draft } from "../../src/copy.ts";
import { approveFor, approveIdsIn, fixFor, fixIdIn, inspectionFor, inspectionIdIn, resultsFor, routeFor, ROUTES } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { standIn, WALK } from "./fixed-fakes.ts";
import { find, mount, RESULTS, until } from "./fixed-screen.tsx";

afterEach(() => {
  window.location.hash = "";
});

describe("the Get It Fixed routes", () => {
  it("round trips each address and routes it to its screen", () => {
    expect(routeFor(fixFor(WALK))).toBe("fix");
    expect(fixIdIn(fixFor(WALK))).toBe(WALK);
    expect(routeFor(inspectionFor(WALK))).toBe("inspection");
    expect(inspectionIdIn(inspectionFor(WALK))).toBe(WALK);
    expect(routeFor(approveFor(WALK, "m 1"))).toBe("approve");
    expect(approveIdsIn(approveFor(WALK, "m 1"))).toEqual({ walkId: WALK, messageId: "m 1" });
    expect(routeFor(ROUTES.history)).toBe("history");
  });

  it("reads an approve address with one id, or three, as no ids at all", () => {
    expect(approveIdsIn(`${ROUTES.approve}/${WALK}`)).toBeNull();
    expect(approveIdsIn(`${ROUTES.approve}/a/b/c`)).toBeNull();
    expect(routeFor(`${ROUTES.approve}/${WALK}`)).not.toBe("approve");
  });
});

describe("the Get It Fixed button on Results", () => {
  it("links a live walk with findings to its Get It Fixed screen", async () => {
    window.location.hash = resultsFor(WALK);
    const view = await mount(resultsFor(WALK), standIn());
    await until(() => view.host.querySelector("[data-part=get-it-fixed]") !== null);
    const link = find(view.host, "[data-part=get-it-fixed]");
    expect(link.textContent).toBe(draft.fixed.title);
    expect(link.getAttribute("href")).toBe(fixFor(WALK));
    await view.unmount();
  });

  it("is the one primary button when the verdict is a list to fix", async () => {
    const view = await mount(resultsFor(WALK), standIn());
    await until(() => view.host.querySelector("[data-part=get-it-fixed]") !== null);
    expect(view.host.querySelector("main")?.dataset.verdict).toBe("fix");
    expect([...view.host.querySelectorAll(".button.primary")].map((b) => b.getAttribute("data-part"))).toEqual(["get-it-fixed"]);
    await view.unmount();
  });

  it("is not offered on a bundled sample house, which the server does not hold", async () => {
    for (const sample of SAMPLES) {
      const view = await mount(resultsFor(sample.id), standIn(), { results: async () => sample });
      await until(() => view.host.querySelector("li.finding") !== null);
      expect(view.host.querySelector("[data-part=get-it-fixed]")).toBeNull();
      await view.unmount();
    }
  });

  it("is not offered on a synthetic walk the server holds", async () => {
    const synthetic = { ...RESULTS, synthetic: true };
    const view = await mount(resultsFor(WALK), standIn(), { results: async () => synthetic });
    await until(() => view.host.querySelector("li.finding") !== null);
    expect(view.host.querySelector("[data-part=get-it-fixed]")).toBeNull();
    await view.unmount();
  });

  it("is not shown when the walk has no findings", async () => {
    const empty = { ...RESULTS, findings: [] };
    const view = await mount(resultsFor(WALK), standIn(), { results: async () => empty });
    await until(() => view.host.querySelector("main") !== null && view.text().length > 0);
    expect(view.host.querySelector("[data-part=get-it-fixed]")).toBeNull();
    await view.unmount();
  });
});

describe("the Fix address of a bundled sample house", () => {
  it("opens that house's results, never Get It Fixed, and asks the server nothing", async () => {
    for (const sample of SAMPLES) {
      const state = standIn();
      const view = await mount(fixFor(sample.id), state, { results: async () => sample });
      await until(() => window.location.hash === resultsFor(sample.id));
      await until(() => view.host.querySelector("li.finding") !== null);
      expect(view.host.querySelector("main.fix")).toBeNull();
      expect(view.host.querySelector("[data-part=get-it-fixed]")).toBeNull();
      expect(state.calls).toEqual([]);
      await view.unmount();
    }
  });

  it("opens the results of a synthetic walk the server holds, never Get It Fixed, and asks the server nothing about it", async () => {
    const synthetic = { ...RESULTS, synthetic: true };
    const state = standIn();
    const view = await mount(fixFor(WALK), state, { results: async () => synthetic });
    await until(() => window.location.hash === resultsFor(WALK));
    await until(() => view.host.querySelector("li.finding") !== null);
    expect(view.host.querySelector("main.fix")).toBeNull();
    expect(view.host.querySelector("[data-part=get-it-fixed]")).toBeNull();
    expect(state.calls).toEqual([]);
    await view.unmount();
  });

  it("still opens Get It Fixed for a live walk", async () => {
    const view = await mount(fixFor(WALK), standIn());
    await until(() => view.host.querySelector("main.fix") !== null);
    expect(window.location.hash).toBe(fixFor(WALK));
    await view.unmount();
  });
});

describe("the Record link on Home", () => {
  it("is on Home and goes to the record", async () => {
    const view = await mount(ROUTES.home, standIn());
    const link = [...view.host.querySelectorAll("a.button")].find((a) => a.textContent === copy.history.title);
    expect(link?.getAttribute("href")).toBe(ROUTES.history);
    await view.unmount();
  });
});
