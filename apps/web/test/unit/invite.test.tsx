import { afterEach, describe, expect, it } from "vitest";
import { accountApi } from "../../src/account-api.ts";
import { App } from "../../src/App.tsx";
import { PORTFOLIO_KEY, inviteWords as w, portfolioWords } from "../../src/draft-words.ts";
import { isTenantWalk, pendingClaim, rememberTenantWalk } from "../../src/walk-claim.ts";
import { portfolioApi } from "../../src/portfolio-api.ts";
import { ROUTES, WALK_START } from "../../src/router.ts";
import { walkRequest } from "../../src/sender.ts";
import type { Take } from "../../src/take-store.ts";
import { testDeps } from "./fakes.ts";
import { id } from "./portfolio-fakes.ts";
import { render, settle } from "./render.ts";

const CODE = "c".repeat(32);

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const mount = async (hash: string, answer: (request: Request) => Response | Promise<Response>) => {
  window.location.hash = hash;
  const send = async (request: Request) => answer(request);
  return render(<App deps={testDeps({ account: accountApi("http://localhost", send, () => "v".repeat(64)), portfolio: portfolioApi("http://localhost", send, () => "v".repeat(64)) })} />);
};

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("the tenant's invite, on a fresh phone with no sign in", () => {
  it("names the home, asks for no sign in, and starts the walk with the code held for it", async () => {
    const asked: string[] = [];
    const view = await mount(`${ROUTES.tenantInvite}/${CODE}`, (request) => {
      asked.push(new URL(request.url).pathname);
      return Response.json({ label: "Cedar Lane Rental", good: true, reason: null });
    });
    await until(() => view.text().includes("Cedar Lane Rental"));
    expect(asked).toEqual([`/api/invites/${CODE}`]);
    expect(view.host.querySelector("input[type=email]")).toBeNull();
    const start = view.host.querySelector<HTMLAnchorElement>("a.primary")!;
    expect(start.getAttribute("href")).toBe(WALK_START);
    await settle(() => start.click());
    expect(pendingClaim()).toEqual({ inviteCode: CODE });
    await view.unmount();
  });

  it.each([
    ["expired", w.expired],
    ["used", w.used],
    ["property_removed", w.removed],
  ])("a %s invite shows its own line and no way to the recorder", async (reason, line) => {
    const view = await mount(`${ROUTES.tenantInvite}/${CODE}`, () => Response.json({ label: "Cedar Lane Rental", good: false, reason }));
    await until(() => view.text().includes(line));
    expect(view.text()).toContain(line);
    expect(view.host.querySelector(`a[href='${WALK_START}']`)).toBeNull();
    await view.unmount();
  });

  it("an unknown invite shows its own line and no way to the recorder", async () => {
    const view = await mount(`${ROUTES.tenantInvite}/${CODE}`, () => Response.json({ error: { code: "invite_unknown", message: "x" } }, { status: 404 }));
    await until(() => view.text().includes(w.unknown));
    expect(view.host.querySelector(`a[href='${WALK_START}']`)).toBeNull();
    await view.unmount();
  });

  it("no signal shows its own line", async () => {
    const view = await mount(`${ROUTES.tenantInvite}/${CODE}`, () => {
      throw new Error("offline");
    });
    await until(() => view.text().includes(w.noSignal));
    expect(view.text()).toContain(w.noSignal);
    await view.unmount();
  });
});

describe("the walk start", () => {
  const take = (over: Partial<Take> = {}) => ({ id: id(1), jurisdiction: "ca", device: null, partOf: null, ...over }) as Take;

  it("carries the invite code", () => {
    expect(walkRequest(take({ inviteCode: CODE }), "v".repeat(64)).inviteCode).toBe(CODE);
  });

  it("carries a manager's property", () => {
    expect(walkRequest(take({ propertyId: id(2) }), "v".repeat(64)).propertyId).toBe(id(2));
  });

  it("names neither when the take has neither, and a side carries neither", () => {
    expect(Object.keys(walkRequest(take(), "v".repeat(64)))).not.toContain("inviteCode");
    const side = walkRequest(take({ inviteCode: CODE, partOf: { walkId: id(3), side: "back" } }), "v".repeat(64));
    expect(Object.keys(side)).not.toContain("inviteCode");
  });
});

describe("the tenant's phone after the walk", () => {
  it("remembers the walk as a tenant's", () => {
    expect(isTenantWalk(id(4))).toBe(false);
    rememberTenantWalk(id(4));
    expect(isTenantWalk(id(4))).toBe(true);
  });
});

describe("the manager's invite screen", () => {
  it("makes the link, shows it once, and offers Copy Link", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const made: string[] = [];
    const view = await mount(`${ROUTES.invite}/${id(1)}`, (request) => {
      made.push(`${request.method} ${new URL(request.url).pathname}`);
      return Response.json({ id: id(7), propertyId: id(1), code: CODE, expiresAt: "2026-11-08T09:00:00.000Z" }, { status: 201 });
    });
    await settle(() => view.host.querySelector<HTMLButtonElement>("button.primary")!.click());
    await until(() => view.text().includes(CODE));
    expect(made).toEqual([`POST /api/properties/${id(1)}/invites`]);
    expect(view.text()).toContain(`${ROUTES.tenantInvite}/${CODE}`);
    expect([...view.host.querySelectorAll("button")].map((b) => b.textContent)).toContain(w.copy);
    await view.unmount();
  });

  it("a removed home shows its own line", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const view = await mount(`${ROUTES.invite}/${id(1)}`, () => Response.json({ error: { code: "property_removed", message: "x" } }, { status: 409 }));
    await settle(() => view.host.querySelector<HTMLButtonElement>("button.primary")!.click());
    await until(() => view.text().includes(portfolioWords.notFound));
    expect(view.text()).toContain(portfolioWords.notFound);
    await view.unmount();
  });
});
