import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DUMMY_TOKEN, centering, leftEdges, screenshotPath, settle, sideways, stubTurnstile } from "./helpers";

const NOTES = process.env.EMBERWALK_NOTES ?? join(homedir(), "Desktop", "emberwalk");

const CONSENT_D84 = "We'll email you about EmberWalk's launch and updates. Privacy";

function approvedCopy() {
  const lines = readFileSync(join(NOTES, "docs", "production", "landing-page.md"), "utf8").split("\n");
  const start = lines.indexOf("---");
  const body = lines.slice(start + 1).map((line) => line.trim()).filter((line) => line !== "");
  const formLines = body.filter((line) => line.startsWith("[ ") && line.endsWith(" ]"));
  const blocks = body.filter((line) => !formLines.includes(line)).map((line) => line.replaceAll("**", ""));
  const roleLine = formLines.find((line) => line.startsWith("[ I'm a:"))!;
  const [first, ...rest] = roleLine.slice(2, -2).split(" / ");
  return {
    blocks,
    placeholder: formLines[0].slice(2, -2),
    options: ["I'm a:", first.replace("I'm a: ", ""), ...rest],
    button: formLines[formLines.length - 1].slice(2, -2),
  };
}

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page);
});

test.describe("page", () => {
  test("has no sideways scroll and keeps every column off the left edge", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const widths = await sideways(page);
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    expect(widths.body).toBeLessThanOrEqual(widths.inner);
    for (const edge of await leftEdges(page, "main h1, main h2, main p:not([hidden]), main form, .wordmark")) {
      expect(edge.left, edge.label).toBeGreaterThanOrEqual(15);
      expect(edge.right, edge.label).toBeGreaterThanOrEqual(15);
    }
  });

  test("shows the approved copy word for word, in order, and nothing else", async ({ page }) => {
    const copy = approvedCopy();
    await page.goto("/");
    const blocks = await page.$$eval("main h1, main h2, main p:not(#signup-status)", (elements) =>
      elements.map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    expect(blocks).toEqual(copy.blocks);
    await expect(page.locator('input[name="email"]')).toHaveAttribute("placeholder", copy.placeholder);
    expect(await page.$$eval('select[name="role"] option', (options) => options.map((option) => option.textContent))).toEqual(copy.options);
    await expect(page.locator("form button")).toHaveText(copy.button);
  });

  test("says what it will email, right under the form, with a Privacy link that opens the privacy page", async ({ page }) => {
    await page.goto("/");
    const consent = page.locator("form + p");
    await expect(consent).toHaveText(CONSENT_D84);
    const link = consent.getByRole("link", { name: "Privacy", exact: true });
    await expect(link).toHaveAttribute("href", "/privacy");
    await link.click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator("h1")).toHaveText("Privacy policy");
  });

  test("has a link with the word privacy in it", async ({ page }) => {
    await page.goto("/");
    expect(await page.$$eval("a", (links) => links.filter((link) => /privacy/i.test(link.textContent ?? "")).length)).toBeGreaterThan(0);
  });

  test("asks for an email and a role and nothing more", async ({ page }) => {
    await page.goto("/");
    const names = await page.$$eval("form input, form select, form textarea", (fields) =>
      fields.map((field) => (field as HTMLInputElement).name),
    );
    expect(names).toEqual(["email", "role"]);
  });

  test("centers headings, labels, lines under them and every button", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const centered = await centering(page, "h1, h2, .wordmark, .lead, .statement, .small, .button, .control");
    expect(centered.length).toBeGreaterThanOrEqual(13);
    for (const item of centered) {
      expect(Math.abs(item.boxCenter - item.pageCenter), `box of ${item.label}`).toBeLessThanOrEqual(1);
    }
    const text = await centering(page, "h1, h2, .wordmark, .lead, .statement, .small, .button");
    for (const item of text) {
      expect(Math.abs(item.textCenter - item.pageCenter), `text of ${item.label}`).toBeLessThanOrEqual(2);
    }
  });

  test("keeps the running paragraphs in a centered column", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const columns = await centering(page, ".column");
    for (const item of columns) expect(Math.abs(item.boxCenter - item.pageCenter)).toBeLessThanOrEqual(1);
  });

  test("lets a visitor reach and hit every control", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const controls = ['input[name="email"]', 'select[name="role"]', "form button", 'a[href="/privacy"]', 'a[href="mailto:hello@emberwalk.app"]'];
    for (const selector of controls) {
      const locator = page.locator(selector);
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeVisible();
      const hit = await locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          reachable: top === element || element.contains(top),
          inside: box.left >= 0 && box.right <= window.innerWidth,
          height: box.height,
        };
      });
      expect(hit.reachable, selector).toBe(true);
      expect(hit.inside, selector).toBe(true);
    }
    for (const selector of ['input[name="email"]', 'select[name="role"]', "form button"]) {
      expect((await page.locator(selector).boundingBox())!.height, selector).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Tab");
    const order: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.tagName ?? ""));
      await page.keyboard.press("Tab");
    }
    expect(order).toEqual(expect.arrayContaining(["email", "role", "BUTTON"]));
  });

  test("loads the font from this site, sets no cookies and calls no other host but Turnstile", async ({ page, context }) => {
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto("/");
    await settle(page);
    expect([...hosts].filter((host) => host !== "127.0.0.1:8799" && host !== "challenges.cloudflare.com")).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('700 1em "Atkinson Hyperlegible"'))).toBe(true);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });

  test("links the privacy page under the form", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Privacy", exact: true });
    await expect(link).toHaveAttribute("href", "/privacy");
    const form = (await page.locator("form").boundingBox())!;
    const linkBox = (await link.boundingBox())!;
    expect(linkBox.y).toBeGreaterThan(form.y + form.height);
    await link.click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});

test.describe("motion", () => {
  test("brings text into focus in place, slowly, with no slide or pop", async ({ page }) => {
    await page.goto("/");
    const before = await page.$$eval(".focus-in", (items) =>
      items.map((item) => {
        const style = getComputedStyle(item);
        return { opacity: style.opacity, transform: style.transform, duration: parseFloat(style.transitionDuration.split(",")[0]) };
      }),
    );
    expect(before.length).toBeGreaterThanOrEqual(10);
    for (const item of before) {
      expect(item.transform).toBe("none");
      expect(item.duration).toBeGreaterThanOrEqual(1.5);
    }
    const hiddenBelowFold = await page.locator(".closing .focus-in").first().evaluate((item) => getComputedStyle(item).opacity);
    expect(hiddenBelowFold).toBe("0");
    await settle(page);
    const after = await page.$$eval(".focus-in", (items) => items.map((item) => getComputedStyle(item).transform));
    expect(after.every((transform) => transform === "none")).toBe(true);
  });

  test("shows everything at once, with no transition, when the visitor asks for less motion", async ({ browser }, info) => {
    const context = await browser.newContext({ ...info.project.use, reducedMotion: "reduce" });
    const page = await context.newPage();
    await stubTurnstile(page);
    await page.goto("/");
    const states = await page.$$eval(".focus-in", (items) =>
      items.map((item) => {
        const style = getComputedStyle(item);
        return { opacity: style.opacity, filter: style.filter, duration: style.transitionDuration };
      }),
    );
    for (const state of states) expect(state).toEqual({ opacity: "1", filter: "none", duration: "0s" });
    expect(await page.evaluate(() => getComputedStyle(document.body, "::before").animationName)).toBe("none");
    await context.close();
  });
});

test.describe("signup form", () => {
  const fill = async (page: import("@playwright/test").Page, email = "neighbor@example.com", role = "homeowner") => {
    await page.fill('input[name="email"]', email);
    if (role) await page.selectOption('select[name="role"]', role);
  };

  test("sends the email, role and Turnstile token, then shows the success message", async ({ page }) => {
    const sent: unknown[] = [];
    await page.route("**/api/signup", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__turnstile)).toEqual({ sitekey: "1x00000000000000000000AA", appearance: "interaction-only" });
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("You're on the list");
    expect(sent).toEqual([{ email: "neighbor@example.com", role: "homeowner", turnstileToken: DUMMY_TOKEN }]);
    await expect(page.locator('input[name="email"]')).toBeHidden();
    await expect(page.locator("form button")).toBeHidden();
  });

  test("shows the approved message when no role is chosen, with no draft mark", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[name="email"]', "neighbor@example.com");
    await page.click("form button");
    const status = page.locator("#signup-status");
    await expect(status).toHaveText("Please choose the one that describes you best.");
    await expect(status).not.toHaveAttribute("data-draft", /.*/);
    expect(await status.evaluate((element) => getComputedStyle(element, "::before").content)).not.toContain("DRAFT");
  });

  test("carries the approved title and meta description", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("EmberWalk | Get your home ready for wildfire season");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "EmberWalk launches Nov. 4th, 2026. Take one walk around your house with your phone and see what could catch, what to fix first, and what California requires.",
    );
    await expect(page.locator("[data-draft]")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-drafts", /.*/);
  });

  for (const [name, email, role] of [
    ["an email that is not one", "nope", "homeowner"],
    ["no role chosen", "neighbor@example.com", ""],
  ] as const) {
    test(`refuses ${name} without sending anything`, async ({ page }) => {
      let calls = 0;
      await page.route("**/api/signup", (route) => {
        calls += 1;
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto("/");
      await fill(page, email, role);
      await page.click("form button");
      await expect(page.locator("#signup-status")).toBeVisible();
      expect(calls).toBe(0);
    });
  }

  test("will not send before the Turnstile check has produced a token", async ({ page }) => {
    let calls = 0;
    await page.unrouteAll();
    await stubTurnstile(page, false);
    await page.route("**/api/signup", (route) => {
      calls += 1;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toBeVisible();
    expect(calls).toBe(0);
  });

  test("resets the Turnstile check and offers another try when the server refuses it", async ({ page }) => {
    await page.route("**/api/signup", (route) => route.fulfill({ status: 403, json: { ok: false, error: "turnstile_failed" } }));
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("person");
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__turnstileResets)).toBe(1);
    await expect(page.locator("form button")).toBeEnabled();
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  for (const [name, route] of [
    ["a server error", (r: import("@playwright/test").Route) => r.fulfill({ status: 500, json: { ok: false, error: "storage_failed" } })],
    ["no connection", (r: import("@playwright/test").Route) => r.abort("failed")],
  ] as const) {
    test(`keeps the form usable after ${name}`, async ({ page }) => {
      await page.route("**/api/signup", route);
      await page.goto("/");
      await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
      await fill(page);
      await page.click("form button");
      await expect(page.locator("#signup-status")).toBeVisible();
      await expect(page.locator("form button")).toBeEnabled();
    });
  }

  test("sets no cookies and stores nothing in the browser after a signup", async ({ page, context }) => {
    await page.route("**/api/signup", (route) => route.fulfill({ json: { ok: true } }));
    await page.goto("/");
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
    await fill(page);
    await page.click("form button");
    await expect(page.locator("#signup-status")).toContainText("You're on the list");
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
});

test("saves screenshots of the page and of the success message", async ({ page }, info) => {
  await page.route("**/api/signup", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await settle(page);
  await page.screenshot({ path: screenshotPath(info, "landing"), fullPage: true });
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__turnstile);
  await page.fill('input[name="email"]', "neighbor@example.com");
  await page.selectOption('select[name="role"]', "homeowner");
  await page.click("form button");
  await expect(page.locator("#signup-status")).toBeVisible();
  await page.locator("#early-access").screenshot({ path: screenshotPath(info, "landing-success") });
});
