import { OFFER_CONFIG } from "@emberwalk/shared";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { LANGUAGE_KEY } from "../../src/prefs.ts";
import { ROUTES } from "../../src/router.ts";
import { entry, id, notWalked } from "../unit/portfolio-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const CODE = "c".repeat(32);
const FAKE_CHECK = "window.turnstile = { render: (_box, options) => { options.callback('person-token'); return 'w'; }, reset: () => {}, remove: () => {} };";

test.use({ locale: "es-MX", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const serve = async (page: Page, signedIn: boolean, plan: { status: string; kind: string | null }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "es"), LANGUAGE_KEY);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_CHECK }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/sign-in/config") return route.fulfill({ json: { turnstileSiteKey: "site-key" } });
    if (pathname === `/api/invites/${CODE}`) return route.fulfill({ json: { label: "Cedar Lane Rental", good: true, reason: null } });
    if (pathname === "/api/billing/plan")
      return route.fulfill({ json: { plan: { ...plan, renewsAt: plan.status === "none" ? null : "2027-11-01T12:00:00.000Z" }, offers: OFFER_CONFIG.offers } });
    if (pathname === "/api/billing/walks") return route.fulfill({ json: { walks: plan.status === "none" ? null : { used: 1, allowed: 4, left: 3 } } });
    if (!signedIn) return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "x" } } });
    if (pathname === "/api/me") return route.fulfill({ json: { accountId: id(900), email: "a.manager.with.a.very.long.address@property-management-example.com" } });
    if (pathname === "/api/properties") {
      if (request.method() === "POST") return route.fulfill({ status: 402, json: { error: { code: "plan_needed", message: "x" } } });
      return route.fulfill({ json: { properties: [notWalked()] } });
    }
    const invite = /^\/api\/properties\/([^/]+)\/invites$/.exec(pathname);
    if (invite !== null) return route.fulfill({ status: 201, json: { id: id(800), propertyId: invite[1], code: CODE, expiresAt: "2026-11-08T09:00:00.000Z" } });
    if (/^\/api\/properties\/[^/]+$/.test(pathname)) return route.fulfill({ json: entry(3, "Oak Road Units", "not_walked") });
    return route.fulfill({ status: 503, json: { error: { code: "server_error", message: "x" } } });
  });
};

const fits = async (page: Page, name: string) => {
  expect(await page.evaluate(sideways), `${name}: sideways`).toBeLessThanOrEqual(0);
  expect(await page.evaluate(offCentre), `${name}: off centre`).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
};

test("Sign In, Your Plan, Your Homes, the invite and the crew signup fit at 390 px in Spanish", async ({ page }) => {
  await serve(page, false, { status: "none", kind: null });
  await page.goto(`/${ROUTES.signIn}`);
  await expect(page.getByLabel("Su correo")).toBeVisible();
  await fits(page, "sign-in");
  await page.goto(`/${ROUTES.crews}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registre su cuadrilla");
  await fits(page, "crew-signup");
  await page.goto(`/${ROUTES.plan}`);
  await expect(page.getByText("Personas propietarias y administradoras de propiedades")).toBeVisible();
  await fits(page, "plan-offers");
  await page.goto(`/${ROUTES.tenantInvite}/${CODE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tiene una invitación para recorrer esta casa");
  await fits(page, "tenant-invite");
});

test("Your Plan with a plan, Your Homes, the plan refusal and the invite fit at 390 px in Spanish", async ({ page }) => {
  await serve(page, true, { status: "active", kind: "individual" });
  await page.goto(`/${ROUTES.plan}`);
  await expect(page.getByText("Más de una casa necesita el plan para personas propietarias y administradoras de propiedades.")).toBeVisible();
  await fits(page, "plan-active");
  await page.goto(`/${ROUTES.homes}`);
  await expect(page.locator("li[data-home]")).toHaveCount(1);
  await page.getByLabel("Ponga nombre a esta casa").fill("Casa nueva");
  await page.getByRole("button", { name: "Agregar casa" }).click();
  await expect(page.getByText("Más de una casa requiere el plan para quienes administran viviendas de alquiler.")).toBeVisible();
  await fits(page, "homes-plan-needed");
  await page.goto(`/${ROUTES.property}/${notWalked().id}`);
  await expect(page.getByText("Todavía no hay recorridos. Invite a una persona inquilina o recorra la casa por su cuenta.")).toBeVisible();
  await fits(page, "property");
  await page.getByRole("link", { name: "Invitar a una persona inquilina" }).click();
  await page.getByRole("button", { name: "Crear enlace de invitación" }).click();
  await expect(page.locator("[data-part='invite-link']")).toBeVisible();
  await fits(page, "invite");
});
