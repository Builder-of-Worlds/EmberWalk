import { afterEach, describe, expect, it, vi } from "vitest";
import { draft } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import type { Deps } from "../../src/deps.ts";
import type { Locate } from "../../src/location.ts";
import { JURISDICTION_KEY, storagePrefs } from "../../src/prefs.ts";
import { ROUTES } from "../../src/router.ts";
import { Rules } from "../../src/screens/Rules.tsx";
import { memoryPrefs, memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const show = (deps: Deps) => render(<DepsContext.Provider value={deps}>{<Rules />}</DepsContext.Provider>);

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const checked = (host: HTMLElement) => host.querySelector<HTMLInputElement>("input:checked")?.value ?? null;
const confirm = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button.primary") as HTMLButtonElement;
const pick = (host: HTMLElement, code: string) =>
  settle(() => host.querySelector<HTMLInputElement>(`input[value="${code}"]`)?.click());

afterEach(() => {
  window.location.hash = "";
});

describe("Which rules apply", () => {
  it("asks for location when the step begins, and only then", async () => {
    const locate = vi.fn<Locate>(async () => ({ latitude: 38.58, longitude: -121.49 }));
    const deps = testDeps({ locate });
    expect(locate).not.toHaveBeenCalled();
    const view = await show(deps);
    await until(() => checked(view.host) !== null);
    expect(locate).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("offers no choice and cannot confirm while still finding the location", async () => {
    const view = await show(testDeps({ locate: () => new Promise(() => undefined) }));
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(draft.rules.finding);
    expect(view.host.querySelectorAll("input[type=radio]")).toHaveLength(0);
    expect(confirm(view.host).disabled).toBe(true);
    await view.unmount();
  });

  it("offers the rules found from a California location, and stores the confirmed choice", async () => {
    const storage = memoryStorage();
    const deps = testDeps({ prefs: memoryPrefs(storage), locate: async () => ({ latitude: 34.05, longitude: -118.24 }) });
    const view = await show(deps);
    await until(() => checked(view.host) === "ca");
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(draft.rules.found);
    await pick(view.host, "ca_vhfhsz");
    await settle(() => confirm(view.host).click());
    expect(storage.getItem(JURISDICTION_KEY)).toBe("ca_vhfhsz");
    expect(deps.prefs.jurisdiction()).toBe("ca_vhfhsz");
    expect(window.location.hash).toBe(ROUTES.record);
    await view.unmount();
  });

  it("still reaches a choice when location is refused, with nothing picked for the homeowner", async () => {
    const deps = testDeps({ locate: async () => ({ refusal: "denied" }) });
    const view = await show(deps);
    await until(() => view.host.querySelectorAll("input[type=radio]").length === 3);
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(draft.rules.refused);
    expect(checked(view.host)).toBeNull();
    await settle(() => confirm(view.host).click());
    expect(deps.prefs.jurisdiction()).toBeNull();
    expect(window.location.hash).toBe("");
    await pick(view.host, "ca_sra");
    await settle(() => confirm(view.host).click());
    expect(deps.prefs.jurisdiction()).toBe("ca_sra");
    await view.unmount();
  });

  it("reaches a choice when finding the location throws", async () => {
    const view = await show(testDeps({ locate: () => Promise.reject(new Error("gone")) }));
    await until(() => view.host.querySelector("[role=status]")?.textContent === draft.rules.refused);
    expect(view.host.querySelectorAll("input[type=radio]")).toHaveLength(3);
    await view.unmount();
  });

  it("picks nothing outside California and says so", async () => {
    const view = await show(testDeps({ locate: async () => ({ latitude: 36.17, longitude: -115.14 }) }));
    await until(() => view.host.querySelector("[role=status]")?.textContent === draft.rules.outside);
    expect(checked(view.host)).toBeNull();
    await view.unmount();
  });

  it("does not store anything of where the phone is", async () => {
    const storage = memoryStorage();
    const deps = testDeps({ prefs: memoryPrefs(storage), locate: async () => ({ latitude: 38.123456, longitude: -121.654321 }) });
    const view = await show(deps);
    await until(() => checked(view.host) === "ca");
    await settle(() => confirm(view.host).click());
    const kept = Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? "")).join(" ");
    expect(kept).not.toMatch(/38\.12|121\.65/);
    await view.unmount();
  });

  it("keeps the choice for this visit when the phone refuses to store it", () => {
    const prefs = storagePrefs(refusingStorage);
    expect(prefs.jurisdiction()).toBeNull();
    prefs.setJurisdiction("ca_vhfhsz");
    expect(prefs.jurisdiction()).toBe("ca_vhfhsz");
  });

  it("reads the stored choice back after the app reopens, and ignores a code that is not one of the rules", () => {
    const storage = memoryStorage();
    storage.setItem(JURISDICTION_KEY, "ca_sra");
    expect(memoryPrefs(storage).jurisdiction()).toBe("ca_sra");
    storage.setItem(JURISDICTION_KEY, "ca_lra");
    expect(memoryPrefs(storage).jurisdiction()).toBeNull();
  });
});
