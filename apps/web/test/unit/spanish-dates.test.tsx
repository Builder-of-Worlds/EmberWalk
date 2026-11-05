import { afterEach, describe, expect, it } from "vitest";
import { accountApi } from "../../src/account-api.ts";
import { App } from "../../src/App.tsx";
import { PORTFOLIO_KEY } from "../../src/draft-words.ts";
import { setLanguage } from "../../src/language.ts";
import { portfolioApi } from "../../src/portfolio-api.ts";
import { LANGUAGE_KEY, storagePrefs } from "../../src/prefs.ts";
import { ROUTES } from "../../src/router.ts";
import { memoryStorage, testDeps } from "./fakes.ts";
import { needsWork, ready } from "./portfolio-fakes.ts";
import { render, settle } from "./render.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const ENGLISH_MONTH = /\b(Jan|Feb|Mar|Apr|June|July|Aug|Sept|Oct|Nov|Dec)\.?\s\d/;

const inSpanish = async (hash: string, answer: () => Response) => {
  const storage = memoryStorage();
  storage.setItem(LANGUAGE_KEY, "es");
  window.localStorage.setItem(PORTFOLIO_KEY, "on");
  window.location.hash = hash;
  const send = async () => answer();
  const deps = testDeps({ account: accountApi("http://localhost", send, () => "v".repeat(64)), portfolio: portfolioApi("http://localhost", send, () => "v".repeat(64)) });
  return render(<App deps={{ ...deps, prefs: storagePrefs(() => storage, () => ["es"]) }} />);
};

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
  setLanguage("en");
});

describe("dates on the landlord screens in Spanish", () => {
  it("Your Homes shows the last walk with a Spanish month", async () => {
    const view = await inSpanish(ROUTES.homes, () => Response.json({ properties: [ready()] }));
    await until(() => view.text().includes("Manzanita Court"));
    expect(view.text()).toContain("13 de octubre de 2026");
    expect(view.text()).not.toMatch(ENGLISH_MONTH);
    await view.unmount();
  });

  it("one home shows the walk day and each Done day with a Spanish month", async () => {
    const home = needsWork();
    const view = await inSpanish(`${ROUTES.property}/${home.id}`, () => Response.json(home));
    await until(() => view.text().includes(home.label));
    expect(view.text()).toContain("15 de octubre de 2026");
    expect(view.text()).toContain("20 de octubre de 2026");
    expect(view.text()).not.toMatch(ENGLISH_MONTH);
    await view.unmount();
  });
});
