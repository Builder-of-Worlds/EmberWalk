import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { propertyStatus } from "@emberwalk/shared";
import type { PropertyEntry } from "@emberwalk/shared";
import { copy } from "../../src/copy.ts";
import { inviteWords, portfolioWords as w, signInWords } from "../../src/draft-words.ts";
import { ROUTES } from "../../src/router.ts";
import { doneWalk, entry, id, needsWork, notWalked, ready } from "../unit/portfolio-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const TOKEN = "T".repeat(43);
const CODE = "c".repeat(32);

type Server = { homes: PropertyEntry[]; mail: string[]; starts: Record<string, unknown>[]; signedIn: boolean };

const LONG_EMAIL = "a.landlord.with.a.very.long.address.that.must.still.fit@property-management-example.com";

const FAKE_CHECK = "window.turnstile = { render: (_box, options) => { options.callback('person-token'); return 'w'; }, reset: () => {}, remove: () => {} };";

const serve = async (context: BrowserContext, server: Server) => {
  await context.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_CHECK }));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const body = request.postData() === null ? null : (JSON.parse(request.postData()!) as Record<string, unknown>);
    const method = request.method();
    if (pathname === "/api/sign-in/config") return route.fulfill({ json: { turnstileSiteKey: "site-key" } });
    if (pathname === "/api/sign-out") {
      server.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (pathname === "/api/sign-in") {
      if (body?.turnstileToken !== "person-token") return route.fulfill({ status: 403, json: { error: { code: "check_failed", message: "x" } } });
      server.mail.push(`http://mail/#/sign-in/${TOKEN}`);
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    if (pathname === "/api/sign-in/verify") {
      if (body?.token !== TOKEN) return route.fulfill({ status: 400, json: { error: { code: "link_invalid", message: "x" } } });
      server.signedIn = true;
      return route.fulfill({ json: { accountId: id(900), email: "manager@example.com" } });
    }
    if (pathname === `/api/invites/${CODE}`) return route.fulfill({ json: { label: server.homes[0]!.label, good: true, reason: null } });
    if (pathname === "/api/walks" && method === "POST") {
      server.starts.push(body!);
      const walk = doneWalk(9, { walkId: id(909), byTenant: true, walkedOn: "2026-10-30", createdAt: "2026-10-30T09:00:00.000Z", state: { name: "uploading" } });
      server.homes[0] = { ...server.homes[0]!, walks: [walk, ...server.homes[0]!.walks] };
      return route.fulfill({ json: { walkId: id(909), state: { name: "uploading" } } });
    }
    if (pathname.startsWith("/api/findings/")) {
      const findingId = pathname.split("/")[3]!;
      server.homes = server.homes.map((home) => {
        const walks = home.walks.map((walk) => {
          const open = walk.open.filter((item) => item.findingId !== findingId);
          return { ...walk, open, openItems: open.length, requiredNowOpen: open.filter((item) => item.requiredNow).length };
        });
        return { ...home, walks, status: propertyStatus(walks) };
      });
      return route.fulfill({ status: 201, json: { mark: {} } });
    }
    if (pathname === "/api/history") return route.fulfill({ json: { walks: [] } });
    if (!server.signedIn) return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "x" } } });
    if (pathname === "/api/me") return route.fulfill({ json: { accountId: id(900), email: LONG_EMAIL } });
    if (pathname === "/api/properties") return route.fulfill({ json: { properties: server.homes } });
    const invite = /^\/api\/properties\/([^/]+)\/invites$/.exec(pathname);
    if (invite !== null) return route.fulfill({ status: 201, json: { id: id(800), propertyId: invite[1], code: CODE, expiresAt: "2026-11-08T09:00:00.000Z" } });
    const one = /^\/api\/properties\/([^/]+)$/.exec(pathname);
    if (one !== null) return route.fulfill({ json: server.homes.find((home) => home.id === one[1]) });
    return route.fulfill({ status: 503, json: { error: { code: "server_error", message: "x" } } });
  });
};

const fresh = (homes: PropertyEntry[] = [needsWork(), ready(), notWalked()]): Server => ({ homes, mail: [], starts: [], signedIn: false });

const signIn = async (page: Page, context: BrowserContext, server: Server) => {
  await serve(context, server);
  await page.goto(`/${ROUTES.signIn}`);
  await page.getByLabel(signInWords.emailLabel).fill("manager@example.com");
  await page.getByRole("button", { name: signInWords.send }).click();
  await expect(page.getByRole("status")).toHaveText(signInWords.codeSent("manager@example.com"));
  const link = server.mail[0]!;
  await page.goto(`/${link.slice(link.indexOf("#"))}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(w.title);
};

const fits = async (page: Page, name: string) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(sideways), `${name} at ${width}`).toBe(0);
    expect(await page.evaluate(offCentre), `${name} at ${width}`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
};

test("a landlord signs in by the link in the mail and sees every home in one place", async ({ page, context }) => {
  const server = fresh();
  await signIn(page, context, server);
  await expect(page.locator("li[data-home]")).toHaveCount(3);
  await fits(page, "homes");
});

test("a landlord on a new phone finds Sign In on Home, sees the account's email, and signs out; no screen names the host", async ({ page, context }) => {
  const server = fresh();
  await serve(context, server);
  const named: string[] = [];
  const read = async () => named.push(await page.locator("body").innerText());
  await page.goto(`/${ROUTES.home}`);
  await fits(page, "home-signed-out");
  await read();
  await page.getByRole("link", { name: signInWords.entry }).click();
  await expect(page.getByLabel(signInWords.emailLabel)).toBeVisible();
  await fits(page, "sign-in");
  await read();
  await page.getByLabel(signInWords.emailLabel).fill("manager@example.com");
  await page.getByRole("button", { name: signInWords.send }).click();
  await expect(page.getByRole("status")).toHaveText(signInWords.codeSent("manager@example.com"));
  await read();
  const link = server.mail[0]!;
  await page.goto(`/${link.slice(link.indexOf("#"))}`);
  await expect(page.getByText(signInWords.signedInAs(LONG_EMAIL))).toBeVisible();
  await fits(page, "homes-signed-in");
  await read();
  await page.getByRole("button", { name: signInWords.signOut, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTES.signIn}$`));
  await read();
  expect(named.join(" ")).not.toMatch(/cloudflare|zero trust|\baccess\b|turnstile/i);
});

test("each home has a status, open items and dates, with no chart", async ({ page, context }) => {
  await signIn(page, context, fresh());
  const row = (label: string) => page.locator("li[data-home]", { hasText: label });
  await expect(row("Cedar Lane Rental")).toContainText(w.status.needs_work);
  await expect(row("Cedar Lane Rental")).toContainText(w.openItems(2));
  await expect(row("Cedar Lane Rental")).toContainText(w.lastWalk("Oct. 15th, 2026"));
  await expect(row("Manzanita Court")).toContainText(w.status.ready);
  await expect(row("Oak Road Units")).toContainText(w.status.not_walked);
  await expect(page.locator("main canvas, main svg")).toHaveCount(0);
});

test("marking the last Required Now item Done turns the home ready on Your Homes", async ({ page, context }) => {
  const server = fresh();
  await signIn(page, context, server);
  await page.locator("li[data-home]", { hasText: "Cedar Lane Rental" }).getByRole("link", { name: w.open }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cedar Lane Rental");
  await expect(page.locator("[data-done]")).toContainText("Oct. 20th, 2026");
  await fits(page, "property");
  await page.locator(`button[data-mark='${id(201)}']`).click();
  await expect(page.locator(".status-line")).toHaveText(w.status.ready);
  await page.getByRole("link", { name: w.backHomes }).click();
  await expect(page.locator("li[data-home]", { hasText: "Cedar Lane Rental" })).toContainText(w.status.ready);
});

test("the Property screen offers the dated record as a download", async ({ page, context }) => {
  await signIn(page, context, fresh());
  await page.locator("li[data-home]", { hasText: "Manzanita Court" }).getByRole("link", { name: w.open }).click();
  const record = page.locator("a[data-part='record']");
  await expect(record).toHaveText(w.record);
  await expect(record).toHaveAttribute("href", `/api/properties/${id(2)}/record`);
  await expect(record).toHaveAttribute("download", "");
});

test("a fresh phone with no sign in walks from the invite, and the walk arrives on the landlord's Property", async ({ page, context, browser, baseURL }) => {
  const server = fresh([entry(1, "Cedar Lane Rental", "not_walked")]);
  await signIn(page, context, server);
  await page.getByRole("link", { name: w.open }).click();
  await page.getByRole("link", { name: w.invite }).click();
  await page.getByRole("button", { name: inviteWords.make }).click();
  const link = (await page.locator("[data-part='invite-link']").innerText()).trim();
  expect(link).toContain(`${ROUTES.tenantInvite}/${CODE}`);
  await fits(page, "invite");

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"], ...(baseURL === undefined ? {} : { baseURL }) });
  await serve(phone, server);
  const tenant = await phone.newPage();
  await tenant.goto(`/${ROUTES.tenantInvite}/${CODE}`);
  await expect(tenant.getByRole("heading", { level: 1 })).toHaveText(inviteWords.tenantTitle);
  await expect(tenant.getByText("Cedar Lane Rental")).toBeVisible();
  await expect(tenant.locator("input[type=email]")).toHaveCount(0);
  await fits(tenant, "tenant-invite");
  await tenant.getByRole("link", { name: inviteWords.start }).click();
  await tenant.getByRole("button", { name: copy.record.start }).click();
  await expect(tenant.locator("video.preview")).toBeVisible();
  await tenant.waitForTimeout(2500);
  await tenant.getByRole("button", { name: copy.record.stop }).click();
  await tenant.getByRole("button", { name: copy.leaves.send }).click();
  await expect.poll(() => server.starts.length).toBe(1);
  expect(server.starts[0]?.inviteCode).toBe(CODE);
  await phone.close();

  await page.goto(`/${ROUTES.property}/${id(1)}`);
  const arrived = page.locator(`li[data-walk='${id(909)}']`);
  await expect(arrived).toContainText(w.walkedOn("Oct. 30th, 2026"));
  await expect(arrived).toContainText(w.byTenant);
  await fits(page, "property-arrived");
});

test("with no sign in, Your Homes sends the phone to Sign In and Home offers Sign In, not Your Homes", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    new URL(route.request().url()).pathname === "/api/history" ? route.fulfill({ json: { walks: [] } }) : route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "x" } } }),
  );
  await page.goto(`/${ROUTES.homes}`);
  await expect(page).toHaveURL(new RegExp(`${ROUTES.signIn}$`));
  await expect(page.locator("main.homes")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: w.entry })).toHaveCount(0);
  await expect(page.getByRole("link", { name: signInWords.entry })).toBeVisible();
});
