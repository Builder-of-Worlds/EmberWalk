import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { findingFor, findingIdsIn, recordPartFor, recordPartIn, resultsFor, routeFor, ROUTES, sendFor } from "../../src/router.ts";
import { testDeps, UNASKED_PORTFOLIO } from "./fakes.ts";
import { render, settle } from "./render.ts";

const UNROUTED = ["#/homes", "#/map", "#/map/x"];

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

afterEach(() => {
  window.location.hash = "";
  setOnline(true);
});

describe("routeFor", () => {
  it("maps each screen's hash to its route", () => {
    expect(routeFor("#/")).toBe("home");
    expect(routeFor("#/record")).toBe("record");
    expect(routeFor("#/send")).toBe("send");
    expect(routeFor("#/results")).toBe("results");
    expect(routeFor(sendFor("walk"))).toBe("send");
    expect(routeFor(resultsFor("walk"))).toBe("results");
    expect(routeFor("#/record/walk")).toBe("record");
  });

  it("sends an empty or unknown hash home", () => {
    expect(routeFor("")).toBe("home");
    expect(routeFor("#")).toBe("home");
    expect(routeFor("#/nowhere")).toBe("home");
  });
});

describe("findingFor and findingIdsIn", () => {
  it("round trip a results id and a finding id, slashes included", () => {
    for (const [resultsId, findingId] of [["walk-1", "a"], ["sample/yard", "wood/pile 1"], ["%", "é"]] as const) {
      const hash = findingFor(resultsId, findingId);
      expect(findingIdsIn(hash)).toEqual({ resultsId, findingId });
      expect(routeFor(hash)).toBe("finding");
    }
  });

  it("refuse a bare, short, long or badly escaped finding hash", () => {
    for (const hash of ["#/finding/", "#/finding/walk", "#/finding/walk/", "#/finding//a", "#/finding/a/b/c", "#/finding/%E0%A4%A/a", "#/results/a/b"]) {
      expect(findingIdsIn(hash), hash).toBeNull();
      expect(routeFor(hash), hash).not.toBe("finding");
    }
    expect(findingIdsIn(ROUTES.finding)).toBeNull();
    expect(routeFor(ROUTES.finding)).toBe("finding");
  });
});

describe("recordPartFor and recordPartIn", () => {
  const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";

  it("round trip a walk and one of its sides onto the record screen", () => {
    for (const side of ["front", "right", "back", "left"] as const) {
      const hash = recordPartFor(WALK, side);
      expect(hash).toBe(`#/record/${WALK}/${side}`);
      expect(recordPartIn(hash)).toEqual({ walkId: WALK, side });
      expect(routeFor(hash)).toBe("record");
    }
  });

  it("open the whole walk for an unknown side, a malformed walk id, or anything extra", () => {
    for (const hash of [`#/record/${WALK}/roof`, `#/record/${WALK}/Back`, `#/record/${WALK}/back_left`, `#/record/${WALK}/front_right`, "#/record/walk-1/back", `#/record/${WALK}`, `#/record/${WALK}/`, `#/record/${WALK}/back/x`, "#/record/%E0%A4%A/back", ROUTES.record]) {
      expect(recordPartIn(hash), hash).toBeNull();
      expect(routeFor(hash), hash).toBe("record");
    }
  });

  it("round trip one corner only while corners are allowed, and still refuse anything else", () => {
    for (const side of ["front_right", "back_right", "back_left", "front_left"] as const) {
      const hash = recordPartFor(WALK, side);
      expect(hash).toBe(`#/record/${WALK}/${side}`);
      expect(recordPartIn(hash, true)).toEqual({ walkId: WALK, side });
      expect(recordPartIn(hash)).toBeNull();
    }
    expect(recordPartIn(recordPartFor(WALK, "left"), true)).toEqual({ walkId: WALK, side: "left" });
    for (const hash of [`#/record/${WALK}/front-right`, `#/record/${WALK}/front_right/x`, "#/record/walk-1/front_right"]) expect(recordPartIn(hash, true), hash).toBeNull();
  });
});

describe("App", () => {
  it("opens on the home screen with the walk button pointing at step 2 before the first walk", async () => {
    const view = await render(<App deps={testDeps()} />);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.home.title);
    const walk = view.host.querySelector("a.primary");
    expect(walk?.textContent).toBe(copy.home.walk);
    expect(walk?.getAttribute("href")).toBe(ROUTES.how);
    await view.unmount();
  });

  it("shows the screen for the hash and follows hash changes", async () => {
    const view = await render(<App deps={testDeps()} />);
    await settle(() => {
      window.location.hash = ROUTES.send;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    for (let i = 0; i < 50 && view.host.querySelector("h1") === null; i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.send.title);
    await settle(() => {
      window.location.hash = ROUTES.record;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.record.title);
    await view.unmount();
  });

  it("says plainly when there is no signal, and clears it when signal returns", async () => {
    const view = await render(<App deps={testDeps()} />);
    expect(view.text()).not.toContain(copy.app.offline);
    await settle(() => setOnline(false));
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.app.offline);
    await settle(() => setOnline(true));
    expect(view.text()).not.toContain(copy.app.offline);
    await view.unmount();
  });

  it("asks no rules question: the old rules hash opens the home screen", async () => {
    expect(routeFor("#/rules")).toBe("home");
    window.location.hash = "#/rules";
    const view = await render(<App deps={testDeps()} />);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.home.title);
    expect(view.host.querySelector("input[type=radio]")).toBeNull();
    await view.unmount();
  });

  it.each(UNROUTED)("treats %s like any unknown address and opens the home screen", async (hash) => {
    expect(routeFor(hash)).toBe(routeFor("#/nowhere"));
    window.location.hash = hash;
    const view = await render(<App deps={testDeps()} />);
    expect(view.host.querySelector("h1")?.textContent).toBe(copy.home.title);
    expect(view.host.querySelector("main.homes, main.map-screen")).toBeNull();
    await view.unmount();
  });

  it("asks for no homes on any screen an address can reach", async () => {
    const asked: string[] = [];
    for (const hash of [...Object.values(ROUTES), ...UNROUTED]) {
      window.location.hash = hash;
      const portfolio = { homes: async () => (asked.push(hash), { value: [] }) };
      const view = await render(<App deps={testDeps({ portfolio })} />);
      await settle(() => new Promise((r) => setTimeout(r, 20)));
      await view.unmount();
    }
    expect(asked).toEqual([]);
  });

  it("the test portfolio refuses loudly when a screen asks it for homes without a test's answer", () => {
    expect(() => testDeps().portfolio.homes()).toThrow(UNASKED_PORTFOLIO);
  });
});
