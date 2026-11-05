import { OFFER_CONFIG } from "@emberwalk/shared";
import type { PropertyEntry } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { PENDING_KEY } from "../../src/billing-api.ts";
import { billingEn as w, PORTFOLIO_KEY, portfolioWords, signInWords } from "../../src/draft-words.ts";
import { ROUTES } from "../../src/router.ts";
import { notWalked } from "../unit/portfolio-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_stand_in";
const PORTAL = "https://billing.stripe.com/p/session/test_stand_in";
const YEAR_END = "2027-11-01T12:00:00.000Z";
const PART_BYTES = 32 * 1024;
const EXPIRES = "2026-10-27T20:00:00.000Z";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const buyIndividual = w.buyPlan(money(OFFER_CONFIG.offers[0].amountCents));
const buyLandlord = w.buyPlan(money(OFFER_CONFIG.offers[1].amountCents));

type Server = { open: boolean; status: string; kind: string | null; left: number; used: number; asked: string[]; bought: unknown[]; billingCalls: number; walkRefusal: string | null; homes: PropertyEntry[] };

const serverOf = (over: Partial<Server> = {}): Server => ({ open: true, status: "none", kind: null, left: 0, used: 0, asked: [], bought: [], billingCalls: 0, walkRefusal: null, homes: [], ...over });

const holds = (server: Server) => ["active", "past_due"].includes(server.status);

const activate = (server: Server, kind = "individual", left = 4) => {
  server.status = "active";
  server.kind = kind;
  server.left = left;
};

const serve = async (page: Page, server: Server) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/billing")) {
      server.billingCalls += 1;
      if (!server.open) return route.fulfill({ status: 503, json: { error: { code: "not_open", message: "Payments are not open yet." } } });
      if (pathname === "/api/billing/plan") {
        const plan = server.status === "none" ? { status: "none", renewsAt: null, kind: null } : { status: server.status, renewsAt: server.status === "refunded" ? null : YEAR_END, kind: server.kind };
        return route.fulfill({ json: { plan, offers: OFFER_CONFIG.offers } });
      }
      if (pathname === "/api/billing/walks")
        return route.fulfill({ json: { walks: holds(server) ? { used: server.used, allowed: server.used + server.left, left: server.left } : null } });
      server.bought.push(request.postDataJSON());
      server.asked.push(pathname);
      if (pathname === "/api/billing/portal") return route.fulfill({ json: { url: PORTAL } });
      return route.fulfill({ json: { url: CHECKOUT } });
    }
    if (pathname === "/api/me") return route.fulfill({ json: { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "manager@example.com" } });
    if (pathname === "/api/sign-out") return route.fulfill({ status: 204 });
    if (pathname === "/api/properties") {
      if (request.method() === "POST") return route.fulfill({ status: 402, json: { error: { code: "plan_needed", message: "This needs a plan." } } });
      return route.fulfill({ json: { properties: server.homes } });
    }
    if (pathname === "/api/walks") {
      if (server.walkRefusal !== null) return route.fulfill({ status: 402, json: { error: { code: server.walkRefusal, message: "Refused." } } });
      if (!holds(server)) return route.fulfill({ status: 402, json: { error: { code: "plan_needed", message: "This needs a plan." } } });
      return route.fulfill({ json: { walkId: WALK, state: { name: "uploading" } } });
    }
    const body = request.postDataJSON() as Record<string, number>;
    if (pathname === "/api/uploads") return route.fulfill({ json: { uploadId: "u-1", partBytes: PART_BYTES, partCount: Math.ceil(body.totalBytes! / PART_BYTES), expiresAt: EXPIRES } });
    if (pathname === "/api/uploads/part") {
      const url = new URL(`/storage/walk.mp4?partNumber=${body.partNumber}`, request.url()).href;
      return route.fulfill({ json: { url, method: "PUT", headers: {}, expiresAt: EXPIRES } });
    }
    if (pathname === "/api/uploads/complete") return route.fulfill({ json: { walkId: WALK, bytes: 1 } });
    if (pathname === `/api/walks/${WALK}`) return route.fulfill({ json: { walkId: WALK, state: { name: "queued" }, failure: null } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  await page.route("**/storage/**", (route) => route.fulfill({ status: 200, headers: { etag: '"e-1"' }, body: "" }));
  const origin = new URL(page.url() === "about:blank" ? test.info().project.use.baseURL! : page.url()).origin;
  const standIn = (links: string) => ({ contentType: "text/html", body: `<!doctype html><title>Stand-in Stripe</title><h1>Stand-in Stripe</h1>${links}` });
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill(standIn(`<a id="pay" href="${origin}/?checkout=done">Pay</a> <a id="back" href="${origin}/?checkout=cancelled">Back</a>`)),
  );
  await page.route("https://billing.stripe.com/**", (route) => route.fulfill(standIn(`<a id="return" href="${origin}/">Return</a>`)));
};

const geometry = async (page: Page, name: string) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(sideways), `${name} at ${width}`).toBe(0);
    expect(await page.evaluate(offCentre), `${name} at ${width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
};

test("with payments off, nothing offers a purchase and the sample walk still opens", async ({ page }) => {
  const server = serverOf({ open: false });
  await serve(page, server);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.getByRole("link", { name: w.entry })).toHaveCount(0);
  await geometry(page, "home, off");
  await page.goto(`/${ROUTES.plan}`);
  await expect(page.getByText(w.notOpen)).toBeVisible();
  await expect(page.locator("main")).not.toContainText("$");
  await expect(page.locator("main button")).toHaveCount(0);
  await geometry(page, "plan, off");
  await page.goto(`/?checkout=done`);
  await expect(page.getByText(w.notOpen)).toBeVisible();
  await expect(page.getByText(w.confirming)).toHaveCount(0);
  server.billingCalls = 0;
  await page.goto("/");
  await expect.poll(() => server.billingCalls).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  server.billingCalls = 0;
  await page.getByRole("link", { name: copy.home.sample }).first().click();
  await expect(page).toHaveURL(/#\/results\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(server.billingCalls).toBe(0);
  expect(server.asked).toEqual([]);
});

test("a walk refused for no plan is kept, the plan is bought through Stripe, a late webhook is waited for, and the walk then sends", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  const server = serverOf();
  await serve(page, server);

  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.send.refused.plan_needed);
  await geometry(page, "send, plan needed");

  await page.getByRole("link", { name: w.choosePlan }).click();
  await expect(page.getByRole("button", { name: buyIndividual })).toBeVisible();
  await expect(page.getByRole("button", { name: buyLandlord })).toBeVisible();
  await geometry(page, "choosing a plan");

  await page.getByRole("button", { name: buyLandlord }).click();
  await expect(page).toHaveURL(CHECKOUT);
  expect(server.bought).toEqual([{ kind: "landlord" }]);

  await page.locator("#pay").click();
  await expect(page.getByText(w.confirming)).toBeVisible();
  await expect(page.getByRole("button", { name: buyLandlord })).toHaveCount(0);
  await geometry(page, "waiting for the webhook");

  activate(server, "landlord", 15);
  await expect(page.getByText(w.done)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(w.name.landlord)).toBeVisible();
  await expect(page.getByText(w.walksLine(0, 15))).toBeVisible();
  await geometry(page, "plan ready");
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(page.getByText(w.done)).toBeVisible();

  await page.getByRole("link", { name: w.home }).click();
  await expect(page.getByRole("link", { name: w.entry })).toBeVisible();
  await expect(page.getByText(signInWords.afterPurchase)).toBeVisible();
  await geometry(page, "home, on");
  await page.locator(".walks").getByRole("link", { name: copy.home.send }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.send.sent, { timeout: 15_000 });
});

test("a plan that has used its walks keeps the walk and leads to the plan screen", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"]);
  const server = serverOf({ walkRefusal: "walks_used" });
  activate(server, "individual", 0);
  server.used = 4;
  await serve(page, server);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await page.getByRole("button", { name: copy.leaves.send }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.send.refused.walks_used);
  await geometry(page, "send, walks used");
  await page.getByRole("link", { name: w.seePlan }).click();
  await expect(page.getByText(w.walksLine(4, 0))).toBeVisible();
});

test("a refused second home leads to the plan screen, and an individual plan names the landlord plan", async ({ page, context }) => {
  await context.addInitScript((key) => window.localStorage.setItem(key, "on"), PORTFOLIO_KEY);
  const server = serverOf({ homes: [{ ...notWalked(), synthetic: false }] });
  activate(server, "individual", 3);
  await serve(page, server);
  await page.goto(`/${ROUTES.homes}`);
  await page.getByLabel(portfolioWords.addLabel).fill("Second Home");
  await page.getByRole("button", { name: portfolioWords.add }).click();
  await expect(page.getByRole("alert")).toHaveText(portfolioWords.planNeeded);
  await geometry(page, "homes, plan needed");
  await page.getByRole("link", { name: w.choosePlan }).click();
  await expect(page.getByText(w.toLandlord)).toBeVisible();
});

for (const [status, line] of [
  ["past_due", w.pastDue],
  ["unpaid", w.onHold],
  ["refunded", w.refunded],
  ["canceled", w.ended],
] as const) {
  test(`a ${status} plan says so, at both widths`, async ({ page }) => {
    const server = serverOf({ status, kind: "individual", left: 3 });
    await serve(page, server);
    await page.goto(`/${ROUTES.plan}`);
    await expect(page.getByText(line)).toBeVisible();
    await geometry(page, `plan ${status}`);
  });
}

test("a return in a browser that started no purchase says the truth and offers the plans at once", async ({ page }) => {
  await serve(page, serverOf());
  await page.goto("/?checkout=done");
  await expect(page.getByText(w.notHere)).toBeVisible();
  await expect(page.getByRole("button", { name: buyIndividual })).toBeEnabled();
  await expect(page.getByText(w.confirming)).toHaveCount(0);
  await geometry(page, "return with no purchase");
});

test("Sign Out clears a purchase this phone was waiting on", async ({ page, context }) => {
  await context.addInitScript((key) => window.localStorage.setItem(key, "on"), PORTFOLIO_KEY);
  await serve(page, serverOf());
  await page.goto(`/${ROUTES.homes}`);
  await page.evaluate((key) => window.sessionStorage.setItem(key, JSON.stringify({ kind: "plan" })), PENDING_KEY);
  await page.getByRole("button", { name: signInWords.signOut, exact: true }).click();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_KEY)).toBeNull();
});

test("abandoning Checkout says nothing was charged and the plans can be chosen again", async ({ page }) => {
  const server = serverOf();
  await serve(page, server);
  await page.goto(`/${ROUTES.plan}`);
  await page.getByRole("button", { name: buyIndividual }).click();
  await expect(page).toHaveURL(CHECKOUT);
  await page.locator("#back").click();
  await expect(page.getByText(w.cancelled)).toBeVisible();
  await expect(page.getByRole("button", { name: buyIndividual })).toBeEnabled();
  await geometry(page, "after abandon");
});

test("buying extra walks waits until the walks arrive, and the portal opens from the plan", async ({ page }) => {
  const server = serverOf();
  activate(server, "individual", 3);
  server.used = 1;
  await serve(page, server);
  await page.goto(`/${ROUTES.plan}`);
  await expect(page.getByText(w.walksLine(1, 3))).toBeVisible();
  await expect(page.getByText(w.extraLead(money(OFFER_CONFIG.extraWalk.amountCents)))).toBeVisible();
  await geometry(page, "holding a plan");

  await page.getByLabel(w.extraCount).selectOption("2");
  await page.getByRole("button", { name: w.buyExtra(2, money(OFFER_CONFIG.extraWalk.amountCents * 2)) }).click();
  await expect(page).toHaveURL(CHECKOUT);
  expect(server.bought).toEqual([{ count: 2 }]);
  await page.locator("#pay").click();
  await expect(page.getByText(w.confirming)).toBeVisible();
  server.left = 5;
  await expect(page.getByText(w.doneExtra)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(w.walksLine(1, 5))).toBeVisible();

  await page.getByRole("button", { name: w.manage }).click();
  await expect(page).toHaveURL(PORTAL);
  await page.locator("#return").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await expect(page.getByRole("link", { name: w.entry })).toBeVisible();
});
