import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { draft } from "../../src/copy.ts";
import { crewWords, demoWords, findingWords, inspectionWords } from "../../src/draft-words.ts";
import { findingFor, fixFor, inspectionFor, ROUTES } from "../../src/router.ts";
import { respond, standIn, WALK } from "../unit/fixed-fakes.ts";
import { liveBody } from "../unit/result-fakes.ts";
import { offCentre, sideways } from "./geometry.ts";

const SAMPLE = "sample-test-yard";
const ITEM = "wood-pile-1";
const CONTACT = { agency: "Test Fire District", email: "inspect@fire.example", source: "https://fire.example/inspections", readOn: "2026-10-31" };

const fits = async (page: Page) => {
  expect(await page.evaluate(sideways), "no sideways scroll at this width").toBe(0);
  expect(await page.evaluate(offCentre), "headings and buttons centred").toEqual([]);
};

test("a crew lists itself, and the page fits the phone", async ({ page }) => {
  const state = standIn();
  await page.route("**/api/crew-signups", async (route) => {
    const reply = respond(state, "POST", "/api/crew-signups", route.request().postDataJSON());
    await route.fulfill({ status: reply.status, json: reply.json });
  });
  await page.goto(`/${ROUTES.crews}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(crewWords.title);
  await fits(page);
  await page.getByLabel(crewWords.name).fill("Ridge Brush");
  await page.getByLabel(crewWords.license).fill("2000001");
  await page.getByLabel(crewWords.email).fill("office@ridge.test");
  await page.getByLabel(crewWords.zip).fill("95370");
  await page.locator("#crew-agree").check();
  await page.getByRole("button", { name: crewWords.submit }).click();
  await expect(page.getByText(crewWords.checkEmail)).toBeVisible();
  await fits(page);
});

test("a sample house runs Get It Fixed to the demo inbox with no call to the server, and every step fits the phone", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/api/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "no" } } });
  });
  await page.goto(`/${findingFor(SAMPLE, ITEM)}`);
  await expect(page.getByRole("button", { name: findingWords.hear })).toBeVisible();
  await fits(page);
  await page.getByRole("link", { name: findingWords.help }).click();
  await expect(page.locator("main.fix")).toHaveAttribute("data-walk", SAMPLE);
  await page.locator("#zip").fill("95370");
  await page.getByRole("button", { name: draft.fixed.zipButton }).click();
  await expect(page.getByText(draft.fixed.sample).first()).toBeVisible();
  await fits(page);
  await page.getByRole("button", { name: draft.fixed.writeRequests }).click();
  await page.getByRole("link", { name: draft.fixed.review }).first().click();
  await expect(page.locator("main.approve")).toBeVisible();
  await fits(page);
  await page.getByRole("button", { name: draft.approve.email }).click();
  await expect(page.getByText(draft.approve.sentEmail)).toBeVisible();
  await page.goto(`/${fixFor(SAMPLE)}`);
  await expect(page.getByRole("heading", { name: demoWords.inboxTitle })).toBeVisible();
  await expect(page.getByText(demoWords.inboxLead)).toBeVisible();
  await fits(page);
  expect(asked.filter((url) => /\/api\/(jobs|messages|walks\/sample)/.test(url))).toEqual([]);
});

test("the fire department email offers its source and one tap, and fits the phone", async ({ page }) => {
  const state = standIn();
  state.inspection = { ...state.inspection, contact: CONTACT, messageId: "fa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01" };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === `/api/walks/${WALK}/results`) return route.fulfill({ json: liveBody(WALK, 2) });
    const text = request.postData();
    const reply = respond(state, request.method(), pathname, text === null ? null : JSON.parse(text));
    return route.fulfill({ status: reply.status, json: reply.json });
  });
  await page.goto(`/${inspectionFor(WALK)}`);
  await expect(page.getByRole("button", { name: inspectionWords.email })).toBeVisible();
  await expect(page.getByRole("link", { name: inspectionWords.source })).toHaveAttribute("href", CONTACT.source);
  await fits(page);
  await page.getByRole("button", { name: inspectionWords.email }).click();
  await expect(page.getByText(inspectionWords.sent(CONTACT.agency))).toBeVisible();
  await fits(page);
});
