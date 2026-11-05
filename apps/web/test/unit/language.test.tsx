import { RULES } from "@emberwalk/rules";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { conceptLabel, copy, shortDay, walkDate } from "../../src/copy.ts";
import { copyEs, walkDateEs } from "../../src/copy-es.ts";
import { deleteEverythingEn, deleteEverythingWords, recheckWords, reportWords } from "../../src/draft-words.ts";
import { deleteEverythingEs, recheckEs, reportEs } from "../../src/draft-words-es.ts";
import { language, setLanguage } from "../../src/language.ts";
import { toWalkResults } from "../../src/live-api.ts";
import { noPortfolio } from "../../src/portfolio-api.ts";
import { LANGUAGE_KEY, storagePrefs } from "../../src/prefs.ts";
import { instructionOf } from "../../src/results.ts";
import type { ResultFinding } from "../../src/results.ts";
import { findingFor, resultsFor, ROUTES } from "../../src/router.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { walkRequest } from "../../src/sender.ts";
import type { Take } from "../../src/take-store.ts";
import { memoryStorage, refusingStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { liveBody } from "./result-fakes.ts";

const go = (hash: string) =>
  settle(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

const appWith = (storage: Storage, over: Parameters<typeof testDeps>[0] = {}) => {
  const deps = testDeps({ results: sampleResults, ...over });
  return <App deps={{ ...deps, prefs: storagePrefs(() => storage, () => ["en-US"]) }} />;
};

const pressEspanol = (host: HTMLElement) =>
  act(async () => host.querySelector<HTMLButtonElement>('.language button[lang="es"]')!.click());

const paths = (value: unknown, path = ""): string[] =>
  typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, child]) => paths(child, `${path}.${key}`)) : [path];

afterEach(() => {
  window.location.hash = "";
  setLanguage("en");
  document.documentElement.lang = "en";
});

describe("the language kept on the phone", () => {
  it("follows the phone until a language is chosen", () => {
    expect(storagePrefs(() => memoryStorage(), () => ["es-MX", "en-US"]).language()).toBe("es");
    expect(storagePrefs(() => memoryStorage(), () => ["en-US", "es-MX"]).language()).toBe("en");
    expect(storagePrefs(() => memoryStorage(), () => ["fr-FR"]).language()).toBe("en");
  });

  it("keeps the choice over the phone's language, across visits", () => {
    const storage = memoryStorage();
    storagePrefs(() => storage, () => ["es-MX"]).setLanguage("en");
    expect(storage.getItem(LANGUAGE_KEY)).toBe("en");
    expect(storagePrefs(() => storage, () => ["es-MX"]).language()).toBe("en");
  });

  it("ignores a stored value that is no language, and keeps a choice the phone refuses to store for this visit", () => {
    const storage = memoryStorage();
    storage.setItem(LANGUAGE_KEY, "fr");
    expect(storagePrefs(() => storage, () => ["es-MX"]).language()).toBe("es");
    const refused = storagePrefs(refusingStorage, () => ["en-US"]);
    refused.setLanguage("es");
    expect(refused.language()).toBe("es");
  });
});

describe("the language choice on screen", () => {
  it("offers English and Español on every screen", async () => {
    const shown = await render(appWith(memoryStorage(), { portfolio: noPortfolio }));
    for (const [route, hash] of Object.entries(ROUTES)) {
      await go(hash);
      expect([route, [...shown.host.querySelectorAll(".language button")].map((b) => b.textContent)]).toEqual([route, ["English", "Español"]]);
    }
    await shown.unmount();
  });

  it("changes the words, the page language and what is kept when tapped, and stays chosen on the next visit", async () => {
    const storage = memoryStorage();
    const shown = await render(appWith(storage));
    expect(shown.text()).toContain(copy.home.walk);
    expect(language()).toBe("en");
    await pressEspanol(shown.host);
    expect(shown.text()).toContain(copyEs.home.walk);
    expect(shown.text()).not.toContain("Walk My House");
    expect(document.documentElement.lang).toBe("es");
    expect(shown.host.querySelector('.language button[lang="es"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(storage.getItem(LANGUAGE_KEY)).toBe("es");
    await shown.unmount();
    setLanguage("en");
    const next = await render(appWith(storage));
    expect(next.text()).toContain(copyEs.home.walk);
    await next.unmount();
  });

  it("shows the sample house's results and rule line in Spanish", async () => {
    const shown = await render(appWith(memoryStorage()));
    await pressEspanol(shown.host);
    const sample = SAMPLES[0]!;
    const finding = sample.findings[0]!;
    const rule = RULES.find((r) => r.plain.en === finding.instruction)!;
    await go(resultsFor(sample.id));
    await settle();
    expect(shown.text()).toContain(rule.plain.es);
    expect(shown.text()).not.toContain(rule.plain.en);
    await go(findingFor(sample.id, finding.id));
    await settle();
    expect(shown.host.querySelector(".sentence")!.textContent).toBe(rule.plain.es);
    await shown.unmount();
  });
});

describe("words that follow the choice", () => {
  const finding = { instruction: "as sent", instructions: { en: "in English", es: "en español" } } as ResultFinding;

  it("picks a finding's line in the chosen language, and the line as sent when a kept walk has only that", () => {
    expect(instructionOf(finding)).toBe("in English");
    setLanguage("es");
    expect(instructionOf(finding)).toBe("en español");
    expect(instructionOf({ instruction: "as sent" } as ResultFinding)).toBe("as sent");
  });

  it("still opens a walk from the API that has no line in both languages", () => {
    setLanguage("es");
    const old = toWalkResults(liveBody(), "https://api.test");
    expect(old.findings[0]!.instructions).toBeUndefined();
    expect(instructionOf(old.findings[0]!)).toBe(old.findings[0]!.instruction);
  });

  it("sends a walk in the chosen language", () => {
    const take = { id: "t" } as Take;
    expect(walkRequest(take, "v").language).toBe("en");
    setLanguage("es");
    expect(walkRequest(take, "v").language).toBe("es");
  });

  it("writes dates and concept names in the chosen language", () => {
    const ms = Date.UTC(2026, 10, 4, 20, 5);
    setLanguage("es");
    expect(walkDate(ms)).toBe(walkDateEs(ms));
    expect(shortDay("2026-11-04")).toBe("4 de noviembre de 2026");
    expect(conceptLabel("wood_pile")).toBe("Pilas de leña");
  });

  it("has a Spanish line for every About, recheck and report line", () => {
    for (const [english, spanish] of [
      [deleteEverythingWords, deleteEverythingEs],
      [recheckWords, recheckEs],
      [reportWords, reportEs],
    ]) {
      expect(paths(spanish).sort()).toEqual(paths(english).sort());
    }
    setLanguage("es");
    expect(deleteEverythingWords.heading).toBe(deleteEverythingEs.heading);
    expect(recheckWords.take).toBe(recheckEs.take);
    expect(reportWords.share.make).toBe(reportEs.share.make);
  });

  it("shows the English line again when the language goes back to English", () => {
    setLanguage("es");
    setLanguage("en");
    expect(deleteEverythingWords.heading).toBe(deleteEverythingEn.heading);
    expect(deleteEverythingWords.heading).not.toBe(deleteEverythingEs.heading);
  });
});
