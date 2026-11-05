import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountApi } from "../../src/account-api.ts";
import { App } from "../../src/App.tsx";
import { PORTFOLIO_KEY, portfolioWords as w } from "../../src/draft-words.ts";
import { portfolioApi } from "../../src/portfolio-api.ts";
import { fixFor, resultsFor, ROUTES } from "../../src/router.ts";
import { testDeps } from "./fakes.ts";
import { entry, id, needsWork, notWalked, ready } from "./portfolio-fakes.ts";
import { render, settle } from "./render.ts";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const mount = async (hash: string, answer: (request: Request) => Response | Promise<Response>) => {
  window.location.hash = hash;
  const send = async (request: Request) => answer(request);
  return render(<App deps={testDeps({ account: accountApi("http://localhost", send, () => "v".repeat(64)), portfolio: portfolioApi("http://localhost", send, () => "v".repeat(64)) })} />);
};

beforeEach(() => window.localStorage.setItem(PORTFOLIO_KEY, "on"));

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("Your Homes", () => {
  it("shows every home with its status, open items and last walk date, as a list with no chart", async () => {
    const view = await mount(ROUTES.homes, () => Response.json({ properties: [needsWork(), ready(), notWalked()] }));
    await until(() => view.text().includes("Oak Road Units"));
    const rows = [...view.host.querySelectorAll("main li[data-home]")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(w.status.needs_work);
    expect(rows[0]).toContain(w.openItems(2));
    expect(rows[0]).toContain(w.lastWalk("Oct. 15th, 2026"));
    expect(rows[1]).toContain(w.status.ready);
    expect(rows[2]).toContain(w.status.not_walked);
    expect(view.host.querySelector("canvas, svg.chart, main.homes svg")).toBeNull();
    await view.unmount();
  });

  it("adds a home and shows it", async () => {
    const added = entry(9, "New Duplex", "not_walked");
    const sent: unknown[] = [];
    const view = await mount(ROUTES.homes, async (request) => {
      if (request.method === "POST") {
        sent.push(await request.json());
        return Response.json(added, { status: 201 });
      }
      return Response.json({ properties: [] });
    });
    await until(() => view.text().includes(w.empty));
    const input = view.host.querySelector<HTMLInputElement>("input")!;
    await settle(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New Duplex");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => view.host.querySelector("form")!.requestSubmit());
    await until(() => view.text().includes("New Duplex"));
    expect(sent).toEqual([{ label: "New Duplex" }]);
    expect(view.host.querySelector("li[data-home]")?.textContent).toContain("New Duplex");
    await view.unmount();
  });

  it("names the plan when a second home needs it", async () => {
    const view = await mount(ROUTES.homes, async (request) =>
      request.method === "POST" ? Response.json({ error: { code: "plan_needed", message: "x" } }, { status: 402 }) : Response.json({ properties: [ready()] }),
    );
    await until(() => view.text().includes("Manzanita Court"));
    const input = view.host.querySelector<HTMLInputElement>("input")!;
    await settle(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Second");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => view.host.querySelector("form")!.requestSubmit());
    await until(() => view.text().includes(w.planNeeded));
    expect(view.text()).toContain(w.planNeeded);
    await view.unmount();
  });

  it("no signal shows its own line", async () => {
    const view = await mount(ROUTES.homes, () => {
      throw new Error("offline");
    });
    await until(() => view.text().includes(w.noSignal));
    expect(view.text()).toContain(w.noSignal);
    await view.unmount();
  });
});

describe("one Property", () => {
  const home = needsWork();
  const path = `${ROUTES.property}/${home.id}`;

  it("lists the walk with its date, who walked it, its open items and each Done mark with its day", async () => {
    const view = await mount(path, () => Response.json(home));
    await until(() => view.text().includes(home.label));
    expect(view.host.querySelector("h1")?.textContent).toBe(home.label);
    const walk = view.host.querySelector("li[data-walk]")!;
    expect(walk.textContent).toContain(w.walkedOn("Oct. 15th, 2026"));
    expect(walk.textContent).toContain(w.byTenant);
    expect(walk.textContent).toContain("Dry brush");
    expect(walk.textContent).toContain(w.doneOn("Wood piles", "Oct. 20th, 2026"));
    expect(view.host.querySelector("canvas, main svg")).toBeNull();
    await view.unmount();
  });

  it("links to the walk's results, its Get It Fixed and the invite, and offers the record", async () => {
    const view = await mount(path, () => Response.json(home));
    await until(() => view.text().includes(home.label));
    const hrefs = [...view.host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    const walkId = home.walks[0]!.walkId;
    expect(hrefs).toContain(resultsFor(walkId));
    expect(hrefs).toContain(fixFor(walkId));
    expect(hrefs).toContain(`${ROUTES.invite}/${home.id}`);
    expect(hrefs).toContain(`/api/properties/${home.id}/record`);
    await view.unmount();
  });

  it("marking an item Done posts its day and shows the new status", async () => {
    const posted: unknown[] = [];
    let current = home;
    const view = await mount(path, async (request) => {
      if (request.method === "POST") {
        posted.push([new URL(request.url).pathname, await request.json()]);
        current = { ...home, status: "ready", walks: [{ ...home.walks[0]!, openItems: 1, requiredNowOpen: 0, open: [home.walks[0]!.open[1]!] }] };
        return Response.json({ mark: {} }, { status: 201 });
      }
      return Response.json(current);
    });
    await until(() => view.text().includes(home.label));
    const button = view.host.querySelector<HTMLButtonElement>(`button[data-mark='${id(201)}']`)!;
    await settle(() => button.click());
    await until(() => view.text().includes(w.status.ready));
    const [[where, body]] = posted as [[string, { status: string; doneOn: string }]];
    expect(where).toBe(`/api/findings/${id(201)}/status`);
    expect(body.status).toBe("done");
    expect(body.doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.text()).toContain(w.status.ready);
    await view.unmount();
  });

  it("an unknown or removed home shows its own line", async () => {
    const view = await mount(path, () => Response.json({ error: { code: "not_found", message: "x" } }, { status: 404 }));
    await until(() => view.text().includes(w.notFound));
    expect(view.text()).toContain(w.notFound);
    await view.unmount();
  });

  it("no signal shows its own line", async () => {
    const view = await mount(path, () => {
      throw new Error("offline");
    });
    await until(() => view.text().includes(w.noSignal));
    expect(view.text()).toContain(w.noSignal);
    await view.unmount();
  });
});
