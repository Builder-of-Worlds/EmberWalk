import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { copyEs, draftEs, shortDayEs as appDay } from "../../src/copy-es.ts";
import { deleteEverythingEs, recheckEs, reportEs } from "../../src/draft-words-es.ts";
import { setLanguage } from "../../src/language.ts";
import { LANGUAGE_KEY, storagePrefs } from "../../src/prefs.ts";
import { findingFor, resultsFor, ROUTES } from "../../src/router.ts";
import { noPortfolio } from "../../src/portfolio-api.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { reportWordsEs as paper } from "../../../../workers/api/src/report-words-es.ts";
import { memoryStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const leaves = (value: unknown): string[] =>
  typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(leaves) : [];

const SHOWN_ANYWAY = new Set(leaves(copyEs));

const DRAFT_LINES = new Set(leaves([draftEs, deleteEverythingEs, recheckEs, reportEs]).filter((line) => !SHOWN_ANYWAY.has(line)));

const go = (hash: string) =>
  settle(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const draftLinesOnEveryScreen = async () => {
  const storage = memoryStorage();
  storage.setItem(LANGUAGE_KEY, "es");
  const deps = testDeps({ results: sampleResults, portfolio: noPortfolio });
  const shown = await render(<App deps={{ ...deps, prefs: storagePrefs(() => storage, () => ["es-MX"]) }} />);
  const sample = SAMPLES[0]!;
  const seen = new Map<string, string>();
  const hashes = [...Object.values(ROUTES), resultsFor(sample.id), findingFor(sample.id, sample.findings[0]!.id)];
  for (const hash of hashes) {
    await go(hash);
    await settle();
    for (const el of shown.host.querySelectorAll("*")) {
      const text = el.textContent?.trim() ?? "";
      if (DRAFT_LINES.has(text)) seen.set(text, hash);
    }
  }
  await shown.unmount();
  return seen;
};

afterEach(() => {
  window.location.hash = "";
  setLanguage("en");
  document.documentElement.lang = "en";
});

describe("the formerly held Spanish", () => {
  it("shows its lines on the screens of a Spanish phone with no switch to turn on", async () => {
    expect((await draftLinesOnEveryScreen()).size).toBeGreaterThan(0);
  });
});

describe("the Spanish report and the phone say the same words", () => {
  it("keeps the reviewed app lines word for word", () => {
    expect(paper.title).toBe(copyEs.history.title);
    expect(paper.lockupAlt).toBe(copyEs.app.mark);
    expect(paper.lead).toBe(copyEs.results.lead);
    expect(paper.bands).toEqual(copyEs.results.bands);
    expect(paper.label).toEqual(copyEs.results.label);
    expect(paper.status).toEqual(copyEs.status.kind);
    expect(paper.rechecked).toBe(copyEs.status.rechecked);
    expect(paper.notRechecked).toBe(copyEs.status.notRechecked);
    expect(paper.source).toBe(copyEs.finding.source);
    expect(paper.doneOn("2026-11-04")).toBe(draftEs.status.doneOn("2026-11-04"));
    expect(paper.shortDay("2026-11-04")).toBe(appDay("2026-11-04"));
    for (const count of [1, 3]) expect(paper.fixFirst(count)).toBe(copyEs.results.fixFirst(count));
    for (const low of [0, 3]) for (const high of [0, 3, 9]) if (high >= low) expect(paper.distance(low, high)).toBe(copyEs.results.distance(low === 0 && high === 0 ? { kind: "against" } : low === 0 ? { kind: "within", high } : low === high ? { kind: "about", feet: low } : { kind: "range", low, high }));
    for (const concept of Object.keys(paper.conceptWords)) expect(paper.notChecked(concept)).toBe(copyEs.results.notChecked(concept as never));
    for (const side of ["front", "right", "back", "left"] as const) {
      for (const kind of ["missing", "dark", "first_five_feet", "not_checked"] as const) expect(paper.gap[kind](side)).toBe(copyEs.results.gap({ side, kind, hint: "again" } as never));
    }
    for (const corner of ["front_right", "back_right", "back_left", "front_left"] as const) {
      for (const kind of ["missing", "dark", "first_five_feet", "not_checked"] as const) expect(paper.cornerGap[kind](corner)).toBe(draftEs.corners.gap[kind](corner));
    }
  });
});
