import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { feetSaid } from "../../src/distance.ts";
import type { WalkResults } from "../../src/results.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, walk } from "./result-fakes.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const open = async (results: WalkResults, load = async (id: string) => (id === results.id ? results : null)) => {
  window.location.hash = resultsFor(results.id);
  const view = await render(<App deps={testDeps({ results: load })} />);
  mounted.push(view);
  await until(() => view.host.querySelector("h1") !== null);
  return view;
};

const mounted: { unmount: () => Promise<void> }[] = [];

const labelledBy = (el: Element): string =>
  (el.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .map((id) => (id === "" ? "" : (document.getElementById(id)?.textContent ?? "")))
    .join(" ")
    .trim();

const nameOf = (el: Element): string => {
  const named = [el.getAttribute("aria-label"), labelledBy(el), el.getAttribute("alt"), el.querySelector("title")?.textContent, el.textContent];
  return named.find((n) => n !== null && n !== undefined && n.trim() !== "")?.trim() ?? "";
};

const controls = (host: Element, name: RegExp) =>
  [...host.querySelectorAll<HTMLElement>("a, button, [role=button], [role=link], [role=tab]")].filter((el) => name.test(nameOf(el)));

const named = (host: Element, name: RegExp) => [...host.querySelectorAll("*")].filter((el) => name.test(el.getAttribute("aria-label") ?? "") || (/^H[1-6]$/.test(el.tagName) && name.test(el.textContent ?? "")));

const rowOf = (host: Element, results: WalkResults, findingId: string) =>
  host.querySelector(`a[href="${findingFor(results.id, findingId)}"]`)?.closest("li") ?? null;

const pick = async (host: Element, label: string) => {
  const button = controls(host, new RegExp(`^${label}$`))[0];
  expect(button, `a ${label} button`).toBeDefined();
  await settle(() => button?.click());
};

const h1 = (host: Element) => host.querySelector("h1")?.textContent ?? "";

afterEach(async () => {
  for (const view of mounted.splice(0)) await view.unmount();
  window.location.hash = "";
});

describe("Results gaps", () => {
  it('Detailed view adds distances, confidence, all citations, the video timeline and the house map', async () => {
    const results = walk(
      [
        finding("a", { band: "zone_2", label: "recommended", ...feet(40), confidence: 0.9 }),
        finding("b", { band: "zone_2", label: "recommended", ...feet(60, 70), confidence: 0.6 }),
      ],
      [],
      { coverage: "not_checked" },
    );
    const view = await open(results);
    await pick(view.host, copy.results.detailed);
    for (const f of results.findings) {
      const row = rowOf(view.host, results, f.id);
      expect(row, `a row for ${f.id}`).not.toBeNull();
      const text = row?.textContent ?? "";
      expect(text, `distance on ${f.id}`).toContain(copy.results.distance(feetSaid(f.distanceFeet)));
      expect(text, `confidence on ${f.id}`).toMatch(new RegExp(`${Math.round(f.confidence * 100)}\\s?%|confiden`, "i"));
      for (const s of f.sources) expect(text, `citation on ${f.id}`).toContain(s.citation);
    }
    expect(named(view.host, /timeline/i).length, "the video timeline").toBeGreaterThan(0);
    expect(controls(view.host, /map/i).length, "the house map").toBeGreaterThan(0);
  });

  it('explainer: finding text is the library line in Simple and the explainer in Detailed', async () => {
    const sample = SAMPLES[0]!;
    const view = await open(sample, sampleResults);
    await pick(view.host, copy.results.simple);
    const simple = new Map(sample.findings.map((f) => [f.id, [...(rowOf(view.host, sample, f.id)?.querySelectorAll("p") ?? [])].map((p) => p.textContent ?? "")]));
    await pick(view.host, copy.results.detailed);
    for (const f of sample.findings) {
      const words = new Set(f.sources.map((s) => s.words));
      const shown = [...(rowOf(view.host, sample, f.id)?.querySelectorAll("p") ?? [])].map((p) => p.textContent ?? "");
      const explainer = shown.filter((line) => !simple.get(f.id)?.includes(line) && !words.has(line) && line.split(/\s+/).length >= 15);
      expect(explainer, `an explainer paragraph for ${f.id} in Detailed`).not.toEqual([]);
    }
  });

  it('house map: aerial view, three distance rings, findings pinned by marker, the camera easing down to the proof photo', async () => {
    const results = walk([finding("near", { band: "zone_0", ...feet(3) }), finding("far", { band: "zone_2", label: "recommended", ...feet(50) })]);
    const view = await open(results);
    const entry = controls(view.host, /map/i)[0];
    expect(entry, "a map button on Results").toBeDefined();
    const before = window.location.hash;
    await settle(() => entry?.click());
    await until(() => window.location.hash !== before || named(view.host, /map/i).length > 0);
    const scope = window.location.hash !== before ? view.host : (named(view.host, /map/i).find((el) => el !== entry) ?? null);
    expect(scope, "the map view").not.toBeNull();
    const aerial = [...(scope?.querySelectorAll("img, [role=img], canvas, svg") ?? [])].some((el) => /aerial/i.test(nameOf(el)));
    expect(aerial, "an aerial view").toBe(true);
    for (const ring of [5, 30, 100]) expect(scope?.textContent, `the ${ring} foot ring`).toMatch(new RegExp(`\\b${ring}\\s?(feet|ft)\\b`, "i"));
    for (const f of results.findings) {
      const marker = [...(scope?.querySelectorAll("a, button, [role=button]") ?? [])].some(
        (el) => el.getAttribute("href") === findingFor(results.id, f.id) || nameOf(el).includes(f.instruction),
      );
      expect(marker, `a marker for ${f.id}`).toBe(true);
    }
  });

  it('screens: Get It Fixed, Help Near You and finding status come first, then the house map', async () => {
    const results = walk([finding("a", { band: "zone_0", ...feet(2) })]);
    for (const name of [/get it fixed/i, /help near you/i]) {
      for (const earlier of mounted.splice(0)) await earlier.unmount();
      const view = await open(results);
      const heading = h1(view.host);
      let entry = controls(view.host, name)[0];
      if (entry === undefined) {
        await settle(() => {
          window.location.hash = findingFor(results.id, "a");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        await until(() => view.host.querySelector("main.one-finding") !== null);
        entry = controls(view.host, name)[0];
      }
      expect(entry, `${name} on Results or a finding`).toBeDefined();
      const at = window.location.hash;
      await settle(() => entry?.click());
      await until(() => window.location.hash !== at && h1(view.host) !== "");
      expect(window.location.hash, `${name} opens its own screen`).not.toBe(at);
      expect([heading, copy.home.title, ""], `${name} screen heading`).not.toContain(h1(view.host));
    }
  });
});
