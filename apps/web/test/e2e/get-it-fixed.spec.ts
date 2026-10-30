import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { copy, draft } from "../../src/copy.ts";
import { approveFor, findingFor, fixFor, inspectionFor, resultsFor, ROUTES } from "../../src/router.ts";
import { C1, C3, crew, J1, job, jobsView, K1, M1, M2, message, respond, standIn, WALK } from "../unit/fixed-fakes.ts";
import type { StandIn } from "../unit/fixed-fakes.ts";
import { liveBody, liveFindingId } from "../unit/result-fakes.ts";

const STILL = readFile(new URL("../../src/samples/wood-pile-1.jpg", import.meta.url));

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const serve = async (page: Page, state: StandIn) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === `/api/walks/${WALK}/results`) return route.fulfill({ json: liveBody(WALK, 2) });
    if (pathname.startsWith(`/api/walks/${WALK}/stills/`)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: await STILL });
    const text = request.postData();
    const reply = respond(state, request.method(), pathname, text === null ? null : JSON.parse(text));
    return route.fulfill({ status: reply.status, json: reply.json });
  });
};

const flat = (page: Page) => page.evaluate(sideways);

const offset = (locator: Locator) =>
  locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.parentElement!.closest("li, section, form, main")!;
    const style = getComputedStyle(box);
    const outer = box.getBoundingClientRect();
    const left = outer.left + parseFloat(style.paddingLeft);
    const right = outer.right - parseFloat(style.paddingRight);
    return (text.left + text.right) / 2 - (left + right) / 2;
  });

const expectCentred = async (locators: Locator) => {
  expect(await locators.count()).toBeGreaterThan(0);
  for (const one of await locators.all()) expect(Math.abs(await offset(one)), await one.innerText()).toBeLessThanOrEqual(2);
};

const withinViewport = async (page: Page, locator: Locator, width: number) => {
  for (const one of await locator.all()) {
    const box = await one.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
  }
};

const planned = () => {
  const text = crew(C3, { name: "Texting Crew", email: null, className: "Tree and Palm Contractor (C-49)" });
  return standIn({ planned: jobsView([job(J1, { crews: [crew(C1), text] })], [liveFindingId(2)]) });
};

const drafted = () => {
  const state = planned();
  state.view = state.planned;
  state.view.jobs[0]!.messages = [
    message(M1, C1, { photos: [], status: "sent", sentAt: "2026-10-29T19:00:00.000Z" }),
    message(M2, C3, { channel: "text", subject: null, body: "Hi, could you look at a tree?", photos: [] }),
  ];
  return state;
};

for (const [name, viewport] of [
  ["390 px", { width: 390, height: 844 }],
  ["1440 px", { width: 1440, height: 900 }],
] as const) {
  test.describe(`Get It Fixed at ${name}`, () => {
    test.use({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, timezoneId: "America/Los_Angeles" });

    test("Results to licensed crews to a written request, to its approval and send", async ({ page }) => {
      const state = planned();
      await serve(page, state);
      await page.goto(`/${resultsFor(WALK)}`);
      await page.locator("[data-part=get-it-fixed]").click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(draft.fixed.title);
      await expect(page.getByText(draft.fixed.nothingGoesOut)).toBeVisible();
      expect(await flat(page)).toBe(0);

      await page.getByLabel(draft.fixed.zipLabel).fill("95370");
      await page.getByRole("button", { name: draft.fixed.zipButton }).click();
      await expect(page.getByText(copy.fixed.honest)).toBeVisible();
      await expect(page.locator(".crew")).toHaveCount(2);
      const first = page.locator(".crew").first();
      await expect(first).toContainText("Crew c1");
      await expect(first).toContainText("2.3 miles away");
      await expect(first).toContainText("License status CLEAR on the state list of Oct. 28th, 2026");
      await expect(first.getByRole("link", { name: copy.fixed.call })).toHaveAttribute("href", "tel:+12095550101");
      await expect(first.getByRole("link", { name: draft.fixed.text })).toHaveAttribute("href", /^sms:/);
      await expect(first.getByRole("link", { name: copy.fixed.checkLicense })).toHaveAttribute("target", "_blank");
      expect(await flat(page)).toBe(0);
      await expectCentred(page.locator("main h1, main h2"));

      await page.getByRole("button", { name: draft.fixed.writeRequests }).click();
      await page.getByRole("link", { name: draft.fixed.review }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(draft.approve.title);
      await expect(page.getByText(draft.approve.nothingSent)).toBeVisible();
      expect(state.calls.filter((c) => c.path.endsWith("/approve"))).toEqual([]);
      expect(await flat(page)).toBe(0);
      await expectCentred(page.locator("main button, main a.button"));

      await page.getByRole("button", { name: draft.approve.email }).click();
      await expect(page.getByText(draft.approve.sentEmail)).toBeVisible();
      expect(state.calls.filter((c) => c.path.endsWith("/approve"))).toHaveLength(1);
      expect(await flat(page)).toBe(0);
      await withinViewport(page, page.locator("main > *"), viewport.width);
    });

    test("a reply is logged and shown on the Get It Fixed screen", async ({ page }) => {
      const state = drafted();
      await serve(page, state);
      await page.goto(`/${fixFor(WALK)}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(draft.fixed.title);
      await page.getByLabel(draft.fixed.replyLabel).fill("We can come Tuesday.");
      await page.getByRole("button", { name: draft.fixed.logReply }).click();
      await expect(page.getByText("We can come Tuesday.")).toBeVisible();
      expect(await flat(page)).toBe(0);
    });

    test("Done asks for the day, defaults to today, and posts it to the server", async ({ page }) => {
      const state = planned();
      await serve(page, state);
      await page.clock.setFixedTime(new Date("2026-10-29T06:30:00Z"));
      await page.goto(`/${findingFor(WALK, liveFindingId(1))}`);
      await page.getByRole("button", { name: copy.status.kind.done }).click();
      const day = page.locator("#done-day");
      await expect(day).toHaveAttribute("type", "date");
      expect(await day.inputValue()).toBe("2026-10-28");
      expect(await flat(page)).toBe(0);
      await day.fill("2026-10-26");
      await page.getByRole("button", { name: copy.status.save }).click();
      await expect(page.getByText("Done on Oct. 26th, 2026.").first()).toBeVisible();
      const posts = state.calls.filter((c) => c.path === `/api/findings/${liveFindingId(1)}/status`);
      expect(posts.map((c) => c.body)).toEqual([{ status: "done", doneOn: "2026-10-26" }]);
      expect(await flat(page)).toBe(0);
    });

    test("the Defensible Space Record lists walks and marks with their days", async ({ page }) => {
      const state = standIn({
        history: {
          walks: [
            {
              walkId: WALK,
              walkedOn: "2026-10-27",
              synthetic: false,
              state: "done",
              marks: [{ id: K1, findingId: liveFindingId(1), concept: "wood_pile", status: "done", note: "Hauled away.", doneOn: "2026-10-28", markedAt: "2026-10-28T19:00:00.000Z" }],
            },
          ],
        },
      });
      await serve(page, state);
      await page.goto("/");
      await page.getByRole("link", { name: copy.history.title }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.history.title);
      await expect(page.locator("li.finding[data-mark]")).toHaveCount(1);
      await expect(page.locator("li.finding[data-mark]")).toContainText("Oct. 28th, 2026");
      await expect(page.locator("li.finding[data-mark] q")).toHaveText("Hauled away.");
      expect(await flat(page)).toBe(0);
      await expectCentred(page.locator("main h1, main h2"));
    });

    test("the inspection request shows its text when every item is Done, and what is open when not", async ({ page }) => {
      const ready = standIn();
      await serve(page, ready);
      await page.goto(`/${inspectionFor(WALK)}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(draft.inspection.title);
      await expect(page.getByText("Please inspect my defensible space.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Fire rules" })).toHaveAttribute("target", "_blank");
      await expect(page.getByRole("button", { name: draft.inspection.copy })).toBeVisible();
      expect(await flat(page)).toBe(0);

      const waiting = await page.context().newPage();
      await serve(waiting, standIn({ ready: false }));
      await waiting.goto(`/${inspectionFor(WALK)}`);
      await expect(waiting.getByRole("heading", { level: 1 })).toHaveText(draft.inspection.notReady);
      await expect(waiting.getByText(draft.fixed.problem("not_ready"))).toBeVisible();
      await expect(waiting.getByText("Move the wood pile")).toHaveCount(0);
      expect(await flat(waiting)).toBe(0);
      await expectCentred(waiting.locator("main h1"));

      const none = await page.context().newPage();
      await serve(none, standIn({ inspectionError: { status: 409, code: "conflict", message: `walk ${WALK} has no Required Now item` } }));
      await none.goto(`/${inspectionFor(WALK)}`);
      await expect(none.getByText(draft.inspection.noRequired)).toBeVisible();
      await expect(none.getByText(WALK)).toHaveCount(0);
      expect(await flat(none)).toBe(0);
    });

    test("the loading line of the Fix, record and Approve screens fits the width and goes when the answer comes", async ({ page }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await serve(page, planned());
      await page.route("**/api/walks/*/jobs", async (route) => {
        await gate;
        await route.fallback();
      });
      await page.route("**/api/history", async (route) => {
        await gate;
        await route.fallback();
      });
      for (const address of [fixFor(WALK), ROUTES.history, approveFor(WALK, M1)]) {
        await page.goto(`/${address}`);
        await expect(page.getByText(draft.fixed.loading)).toBeVisible();
        expect(await flat(page)).toBe(0);
      }
      release();
      await page.goto(`/${fixFor(WALK)}`);
      await expect(page.getByText(draft.fixed.loading)).toHaveCount(0);
    });

    test("a request opened from a bare address does not break the page", async ({ page }) => {
      await serve(page, standIn());
      for (const route of [ROUTES.fix, ROUTES.approve, ROUTES.inspection, approveFor(WALK, "nope")]) {
        await page.goto(`/${route}`);
        await expect(page.locator("main").first()).toBeVisible();
        expect(await flat(page)).toBe(0);
      }
    });
  });
}
