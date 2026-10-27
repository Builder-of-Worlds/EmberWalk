import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { findingFor, findingIdsIn, resultsFor, routeFor, ROUTES, sendFor } from "../../src/router.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

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
    expect(routeFor("#/record/walk")).toBe("home");
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
});
