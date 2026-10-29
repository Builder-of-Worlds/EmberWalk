import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { LIVE_WALK, liveBodyAt, liveFindingId } from "../unit/result-fakes.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const BODY = liveBodyAt([[2, 3], [12, 19]]);

const MARKED = new Date("2026-11-02T18:00:00Z");

const EPOCH = String(Math.floor(MARKED.getTime() / 1000)).slice(0, 6);

const dated = (text: string) => text.includes("2026-11-02") || text.includes(EPOCH);

const MARKED_SHOWN = /Nov(ember)?\.? 2(nd)?,? 2026|11\/0?2\/2026|2026-11-02/;

const WALKED_SHOWN = /Oct(ober)?\.? 27(th)?,? 2026|10\/27\/2026|2026-10-27/;

type Seen = { method: string; path: string; body: string };

const ZIP = "95404";

const crew = (n: number, name: string) => ({
  id: `3e9b8d7c-6a5f-4e3d-8c2b-${String(n).padStart(12, "0")}`,
  name,
  trade: "tree_service",
  zip: ZIP,
  email: `crew${n}@example.org`,
  phone: null,
  licenseNumber: String(1_000_000 + n),
  sample: true,
});

const CREWS = [crew(1, "Ridgeline Tree and Brush"), crew(2, "Oak Hollow Clearing")];

const JOB = "7a1c2f4e-0d3b-4b8e-9a51-2e6c7d8f9a01";

const FOLLOW_UP_TEXT = "Checking in on the firewood move at the sample house. Can you still come this week?";

const FOLLOW_UP_DRAFT = {
  id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
  jobId: JOB,
  crewId: CREWS[0]!.id,
  channel: "email",
  status: "draft",
  subject: "Following up",
  body: FOLLOW_UP_TEXT,
  createdAt: "2026-11-05T18:00:00.000Z",
  approvedAt: null,
  sentAt: null,
};

const FOLLOW_UPS = {
  followUps: [{ id: "5c4b3a29-1807-4f6e-9d5c-4b3a29180706", jobId: JOB, dueAt: "2026-11-05T18:00:00.000Z", note: FOLLOW_UP_TEXT, draftMessageId: FOLLOW_UP_DRAFT.id, done: false }],
  drafts: [FOLLOW_UP_DRAFT],
};

const fakeApi = async (page: Page): Promise<Seen[]> => {
  const seen: Seen[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    seen.push({ method: request.method(), path: pathname, body: request.postData() ?? "" });
    if (pathname === `/api/walks/${LIVE_WALK}/results`) return route.fulfill({ json: BODY });
    if (pathname.startsWith(`/api/walks/${LIVE_WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    if (request.method() !== "GET") return route.fulfill({ json: { ok: true } });
    if (/follow|draft/i.test(pathname)) return route.fulfill({ json: FOLLOW_UPS });
    if (/crew|directory|help|near/i.test(pathname)) return route.fulfill({ json: { zip: ZIP, crews: CREWS } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
  return seen;
};

const writes = (seen: Seen[]) => seen.filter((s) => s.method !== "GET").map((s) => `${s.path} ${s.body}`);

const named = (page: Page, name: RegExp) => page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();

const GET_IT_FIXED = /get it fixed|get help|help near you|find (a )?crews?/i;

const markDone = async (page: Page, findingId: string) => {
  await page.goto(`/${findingFor(LIVE_WALK, findingId)}`);
  await page.getByRole("button", { name: copy.status.kind.done, exact: true }).click();
  await expect(page.getByRole("button", { name: copy.status.kind.done, exact: true })).toHaveAttribute("aria-pressed", "true");
};

const openSampleFinding = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("link", { name: copy.home.sample }).click();
  await page.locator("li.finding a").first().click();
  await expect(page.locator("main.one-finding")).toBeVisible();
};

test("the licensed crews near each house can be found", async ({ page }) => {
  await fakeApi(page);
  await openSampleFinding(page);
  await expect(named(page, GET_IT_FIXED), "Get It Fixed on a finding").toBeVisible({ timeout: 5_000 });
  await named(page, GET_IT_FIXED).click();
  const zip = page.getByRole("textbox", { name: /zip/i });
  if (await zip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await zip.fill(ZIP);
    await zip.press("Enter");
  }
  for (const near of CREWS) await expect(page.getByText(near.name).first(), "each licensed crew near the house by name").toBeVisible({ timeout: 5_000 });
});

test("the follow-ups are kept until the work gets done", async ({ page }) => {
  await page.clock.install({ time: MARKED });
  await fakeApi(page);
  await openSampleFinding(page);
  await expect(named(page, GET_IT_FIXED), "Get It Fixed on a finding").toBeVisible({ timeout: 5_000 });
  await named(page, GET_IT_FIXED).click();
  await named(page, /approve|send/i).click({ timeout: 5_000 });
  await page.clock.fastForward("72:00:00");
  await page.reload();
  const drafted = page.getByText(FOLLOW_UP_TEXT).first();
  await expect(drafted, "the drafted follow up after no reply").toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/waiting for (your )?(approval|okay)|needs your (approval|okay)|not sent yet/i).first(), "the follow up waits for the homeowner's okay").toBeVisible();
  await expect(named(page, /approve/i), "the follow up is approved by the homeowner").toBeVisible();
});

test("the fire department inspection can be requested after the work has been done", async ({ page }) => {
  await fakeApi(page);
  for (const finding of BODY.findings) await markDone(page, finding.id);
  await page.goto(`/${resultsFor(LIVE_WALK)}`);
  const request = named(page, /inspection request|request (an |your )?inspection/i);
  await expect(request, "the inspection request once every fix is done").toBeVisible({ timeout: 5_000 });
  await request.click();
  for (const finding of BODY.findings) await expect(page.getByText(finding.instruction).first(), "every fix listed").toBeVisible({ timeout: 5_000 });
  await expect(page.locator("a[href*='fire.ca.gov'], a[href*='readyforwildfire.org']").first(), "the CAL FIRE page that finds the local agency").toBeVisible();
  await expect(named(page, /approve|send/i), "the draft waits for approval").toBeVisible();
});

test("the record keeps the date of every walk, and of every fix marked done", async ({ page, browser }, info) => {
  await page.clock.setFixedTime(MARKED);
  await fakeApi(page);
  await markDone(page, liveFindingId(1));
  await page.goto("/");
  const record = named(page, /record|history/i);
  await expect(record, "a way to the dated record from Home").toBeVisible({ timeout: 5_000 });
  await record.click();
  await expect(page.getByText(WALKED_SHOWN).first(), "the walk's date").toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(BODY.findings[0]!.instruction).first(), "the fix marked done").toBeVisible();
  await expect(page.getByText(MARKED_SHOWN).first(), "the date it was marked done").toBeVisible();
  const where = page.url();

  const fresh = await browser.newContext({ viewport: info.project.use.viewport ?? null, isMobile: true, hasTouch: true });
  const other = await fresh.newPage();
  const seen = await fakeApi(other);
  await other.goto(where);
  const asked = () => seen.some((s) => s.method === "GET" && !s.path.includes("/stills/") && s.path !== `/api/walks/${LIVE_WALK}/results`);
  await expect.poll(asked, { message: "a fresh browser asks the server for the record", timeout: 5_000 }).toBe(true);
  await fresh.close();
});

test("a fix marked done reaches the record with its date", async ({ page }) => {
  await page.clock.setFixedTime(MARKED);
  const seen = await fakeApi(page);
  const id = liveFindingId(1);
  await page.goto(`/${findingFor(LIVE_WALK, id)}`);
  await page.getByRole("button", { name: copy.status.kind.fix_planned, exact: true }).click();
  await page.getByRole("button", { name: copy.status.kind.done, exact: true }).click();
  await expect(page.getByRole("button", { name: copy.status.kind.done, exact: true })).toHaveAttribute("aria-pressed", "true");
  const done = () => writes(seen).some((w) => w.includes(id) && /done/i.test(w) && dated(w));
  await expect.poll(done, { message: "the done mark reached the server with its date", timeout: 5_000 }).toBe(true);
  const sentPlanned = writes(seen).some((w) => w.includes(id) && /planned/i.test(w) && dated(w));
  const shownPlanned = page.getByText(new RegExp(`planned.{0,80}?(${MARKED_SHOWN.source})|(${MARKED_SHOWN.source}).{0,80}?planned`, "i")).first();
  if (!sentPlanned) await expect(shownPlanned, "the planned mark is kept in the history with its date").toBeVisible({ timeout: 5_000 });
});
