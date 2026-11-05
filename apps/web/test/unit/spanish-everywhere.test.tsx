import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { setLanguage } from "../../src/language.ts";
import { LANGUAGE_KEY, storagePrefs } from "../../src/prefs.ts";
import { findingFor, fixFor, inspectionFor, propertyFor, resultsFor, ROUTES } from "../../src/router.ts";
import { SAMPLES, sampleResults } from "../../src/samples.ts";
import { samplePortfolio } from "../../src/samples/portfolio.ts";
import { memoryStorage, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const SAME_IN_BOTH = new Set(["EmberWalk", "English", "Español", "Wildfire Home Check", "WILDFIRE HOME CHECK", "hello@emberwalk.app", "CAL FIRE", "C-27", "C-49", "Stripe"]);

const textsOn = async (hash: string, language: "en" | "es") => {
  const storage = memoryStorage();
  storage.setItem(LANGUAGE_KEY, language);
  window.location.hash = hash;
  const deps = testDeps({ results: sampleResults, portfolio: samplePortfolio });
  const shown = await render(<App deps={{ ...deps, prefs: storagePrefs(() => storage, () => [language]) }} />);
  await settle(() => new Promise((r) => setTimeout(r, 60)));
  const texts = new Set<string>();
  for (const el of shown.host.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    const text = el.textContent?.trim() ?? "";
    if (/[A-Za-z]{2}/.test(text)) texts.add(text);
  }
  await shown.unmount();
  setLanguage("en");
  return texts;
};

afterEach(() => {
  window.location.hash = "";
  setLanguage("en");
});

describe("with Español chosen, no English is left on a product screen", () => {
  const sample = SAMPLES[0]!;
  const home = (async () => (await samplePortfolio.homes()) as { value: { id: string }[] })();
  const screens = async () => [
    ...Object.entries(ROUTES).map(([name, hash]) => [name, hash] as const),
    ["sample results", resultsFor(sample.id)] as const,
    ["sample finding", findingFor(sample.id, sample.findings[0]!.id)] as const,
    ["sample get it fixed", fixFor(sample.id)] as const,
    ["sample inspection", inspectionFor(sample.id)] as const,
    ["a home", propertyFor((await home).value[0]!.id)] as const,
  ];

  it("shows nothing in both languages that is not a name or an address", async () => {
    const left: string[] = [];
    for (const [name, hash] of await screens()) {
      const en = await textsOn(hash, "en");
      const es = await textsOn(hash, "es");
      for (const text of es) if (en.has(text) && !SAME_IN_BOTH.has(text) && !/@|^[\d\s.,:/$%()+-]*$|^Sample: /.test(text)) left.push(`${name}: ${text}`);
    }
    expect(left).toEqual([]);
  });
});
