import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import type { WalkResults } from "../../src/results.ts";
import { findingFor } from "../../src/router.ts";
import { memoryPrefs, memoryStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const open = async (results: WalkResults, findingId: string, storage: Storage) => {
  window.location.hash = findingFor(results.id, findingId);
  const deps = testDeps({ results: async (id) => (id === results.id ? results : null), prefs: memoryPrefs(storage) });
  const view = await render(<App deps={deps} />);
  await until(() => view.host.querySelector("main.one-finding") !== null);
  return view;
};

const button = (host: Element, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label);

afterEach(() => {
  window.location.hash = "";
});

describe("Finding gaps", () => {
  it('switch on the finding screen: Simple and Detailed views are switchable anytime', async () => {
    const results = walk([finding("a")]);
    const storage = memoryStorage();
    const view = await open(results, "a", storage);
    expect(button(view.host, copy.results.simple), "a Simple switch on the finding screen").toBeDefined();
    const detailed = button(view.host, copy.results.detailed);
    expect(detailed, "a Detailed switch on the finding screen").toBeDefined();
    await settle(() => detailed?.click());
    expect(detailed?.getAttribute("aria-pressed")).toBe("true");
    await view.unmount();
    const reopened = await open(results, "a", storage);
    expect(button(reopened.host, copy.results.detailed)?.getAttribute("aria-pressed"), "Detailed kept after a reopen").toBe("true");
    await reopened.unmount();
  });
});
