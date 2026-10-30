import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { draft } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import { portfolioApi } from "../../src/portfolio-api.ts";
import { resultsFor, ROUTES } from "../../src/router.ts";
import { Homes } from "../../src/screens/Homes.tsx";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const PORTFOLIO = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";

const HOMES_ADDRESS = "#/homes";

const property = (n: number, label: string) => ({
  id: `1f2e3d4c-5b6a-4978-8a9b-${String(n).padStart(12, "0")}`,
  portfolioId: PORTFOLIO,
  label,
  synthetic: true,
  createdAt: "2026-10-27T18:00:00.000Z",
});

const serving = (body: unknown, status = 200) =>
  portfolioApi("http://localhost", async () => Response.json(body, { status }), () => "visitor");

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const mounted: { unmount: () => Promise<void> }[] = [];

const open = async (body: unknown, status = 200) => {
  const view = await render(
    <DepsContext.Provider value={testDeps({ portfolio: serving(body, status) })}>
      <Homes />
    </DepsContext.Provider>,
  );
  mounted.push(view);
  await settle(() => new Promise((r) => setTimeout(r, 20)));
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) await view.unmount();
  window.location.hash = "";
});

describe("every home in one place", () => {
  it("says for each home whether it was walked and whether it is ready, and links a walked home to its results", async () => {
    const view = await open({
      portfolio: { id: PORTFOLIO, name: "Rentals" },
      properties: [
        property(1, "12 Cedar Lane"),
        { ...property(2, "40 Manzanita Court"), walk: { id: "walk-ready", ready: true } },
        { ...property(3, "7 Oak Road"), walk: { id: "walk-fix", ready: false } },
      ],
    });
    expect(view.host.querySelector("h1")?.textContent).toBe(draft.portfolio.title);
    const rows = [...view.host.querySelectorAll("main li")].map((li) => [li.querySelector("b")?.textContent, li.querySelector("p")?.textContent, li.querySelector("a")?.getAttribute("href") ?? null]);
    expect(rows).toEqual([
      ["12 Cedar Lane", draft.portfolio.notWalked, null],
      ["40 Manzanita Court", draft.portfolio.ready, resultsFor("walk-ready")],
      ["7 Oak Road", draft.portfolio.needsFixes, resultsFor("walk-fix")],
    ]);
  });

  it("Home never asks the server for homes and offers no way in", async () => {
    let asked = 0;
    window.location.hash = ROUTES.home;
    const portfolio = { homes: async () => ((asked += 1), { value: [] }) };
    const view = await render(<App deps={testDeps({ portfolio })} />);
    mounted.push(view);
    await until(() => view.host.querySelector("h1") !== null);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(asked).toBe(0);
    expect([...view.host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).not.toContain(HOMES_ADDRESS);
  });

  it("lists no home when the server refuses or answers with a home it cannot read", async () => {
    for (const [body, status] of [
      [{ portfolio: { id: PORTFOLIO, name: "Rentals" }, properties: [] }, 200],
      [{ error: { code: "not_found", message: "Not found." } }, 404],
      [{ properties: [{ label: "no id" }] }, 200],
      [{ properties: [{ ...property(1, "12 Cedar Lane"), walk: { id: "", ready: true } }] }, 200],
    ] as const) {
      const view = await open(body, status);
      expect(view.host.querySelector("h1")?.textContent).toBe(draft.portfolio.title);
      expect(view.host.querySelectorAll("main li")).toHaveLength(0);
      await view.unmount();
      mounted.pop();
    }
  });
});
