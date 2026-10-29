import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const EVERY_HOME = /every (home|house|property)|all (your |my )?(homes|houses|properties)|properties|portfolio|my (homes|houses)/i;

const PORTFOLIO = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";

const home = (n: number, label: string) => ({
  id: `1f2e3d4c-5b6a-4978-8a9b-${String(n).padStart(12, "0")}`,
  portfolioId: PORTFOLIO,
  label,
  synthetic: true,
  createdAt: "2026-10-27T18:00:00.000Z",
});

const HOMES = [home(1, "12 Cedar Lane"), home(2, "40 Manzanita Court")];

const answer = (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  if (/propert|portfolio|homes|houses/i.test(url)) return Response.json({ portfolio: { id: PORTFOLIO, name: "Sample Rentals" }, properties: HOMES });
  return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
};

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const entry = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("a, button")].find((el) => EVERY_HOME.test(el.getAttribute("aria-label") ?? el.textContent ?? ""));

afterEach(() => {
  window.location.hash = "";
  vi.unstubAllGlobals();
});

describe("portfolio", () => {
  it("Home offers a way to see every home in one place, each with whether it is ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => answer(input)));
    window.location.hash = "";
    const view = await render(<App deps={testDeps()} />);
    await until(() => view.host.querySelector("h1") !== null);
    const way = entry(view.host);
    expect(way, `Home offers a way to see every home in one place; Home shows: ${view.text()}`).toBeDefined();
    await settle(() => {
      const href = way!.getAttribute("href");
      if (href === null) way!.click();
      else {
        window.location.hash = href;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    });
    await until(() => HOMES.every((h) => view.text().includes(h.label)));
    expect(view.host.querySelector("h1")?.textContent ?? "").toMatch(/home|house|propert/i);
    for (const h of HOMES) expect(view.text(), "every home listed").toContain(h.label);
    const rows = [...view.host.querySelectorAll("main li")].map((li) => li.textContent ?? "").filter((t) => HOMES.some((h) => t.includes(h.label)));
    expect(rows.length).toBe(HOMES.length);
    for (const row of rows) expect(row, "each home says whether it is ready").toMatch(/ready|to fix|needs|not walked/i);
    await view.unmount();
  });
});
