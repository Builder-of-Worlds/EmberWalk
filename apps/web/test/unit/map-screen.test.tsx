import { afterEach, describe, expect, it } from "vitest";
import { draft } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import { MapScreen } from "../../src/screens/MapScreen.tsx";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const RESULTS = walk([finding("near"), finding("far")]);

afterEach(() => {
  window.location.hash = "";
});

describe("the house map screen", () => {
  it("shows its heading and the drawn house for a walk", async () => {
    const deps = testDeps({ results: async (id) => (id === RESULTS.id ? RESULTS : null) });
    const view = await render(
      <DepsContext.Provider value={deps}>
        <MapScreen mapId={RESULTS.id} />
      </DepsContext.Provider>,
    );
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(view.host.querySelector("main.map-screen h1")?.textContent).toBe(draft.detail.mapTitle);
    expect(view.host.querySelector("main.map-screen figure.house-map")).not.toBeNull();
    await view.unmount();
  });
});
