import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { findingWords } from "../../src/draft-words.ts";
import { findingEs } from "../../src/draft-words-es.ts";
import { setLanguage } from "../../src/language.ts";
import { LANGUAGE_KEY, storagePrefs } from "../../src/prefs.ts";
import { instructionOf } from "../../src/results.ts";
import { findingFor, mapFor, resultsFor } from "../../src/router.ts";
import { memoryStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { feet, finding, walk } from "./result-fakes.ts";

const ADVISED = finding("deck", { concept: "wood_deck", advice: true, band: "zone_0", ...feet(2) });
const PLAIN = finding("brush", { concept: "dry_brush", ...feet(4) });
const RESULTS = walk([ADVISED, PLAIN]);

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const open = async (hash: string, language: "en" | "es") => {
  const storage = memoryStorage();
  storage.setItem(LANGUAGE_KEY, language);
  window.location.hash = hash;
  const deps = testDeps({ results: async (id) => (id === RESULTS.id ? RESULTS : null) });
  const view = await render(<App deps={{ ...deps, prefs: storagePrefs(() => storage, () => [language]) }} />);
  await until(() => view.host.querySelector("[data-finding], main.one-finding") !== null);
  return view;
};

afterEach(() => {
  window.location.hash = "";
  setLanguage("en");
});

describe("our advice, not a rule", () => {
  it("is said in English and in Spanish", () => {
    expect(findingWords.advice).toBe("Our advice, not a rule");
    expect(findingEs.advice).toBe("Nuestro consejo, no una regla");
  });

  it.each([
    ["en", "Our advice, not a rule"],
    ["es", "Nuestro consejo, no una regla"],
  ] as const)("shows beside only the advised line on the results list in %s", async (language, words) => {
    const view = await open(resultsFor(RESULTS.id), language);
    const notes = [...view.host.querySelectorAll("[data-part=advice]")];
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes.map((n) => n.textContent))).toEqual(new Set([words]));
    expect(new Set(notes.map((n) => n.closest("[data-finding]")?.getAttribute("data-finding")))).toEqual(new Set(["deck"]));
    await view.unmount();
  });

  it.each([
    ["en", "Our advice, not a rule"],
    ["es", "Nuestro consejo, no una regla"],
  ] as const)("shows under only the advised line on the house map in %s", async (language, words) => {
    const view = await open(mapFor(RESULTS.id), language);
    const notes = [...view.host.querySelectorAll("[data-part=advice]")];
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes.map((n) => n.textContent))).toEqual(new Set([words]));
    for (const note of notes) expect(note.closest("li")?.textContent).toContain(instructionOf(ADVISED));
    await view.unmount();
  });

  it.each([
    ["en", "Our advice, not a rule"],
    ["es", "Nuestro consejo, no una regla"],
  ] as const)("shows on the finding screen of an advised line in %s, and not on another", async (language, words) => {
    const advised = await open(findingFor(RESULTS.id, "deck"), language);
    expect(advised.host.querySelector("main.one-finding [data-part=advice]")?.textContent).toBe(words);
    await advised.unmount();
    const plain = await open(findingFor(RESULTS.id, "brush"), language);
    expect(plain.host.querySelector("[data-part=advice]")).toBeNull();
    await plain.unmount();
  });
});
