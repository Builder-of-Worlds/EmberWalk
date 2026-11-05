import { expect, test, type Page, type Response } from "@playwright/test";
import { lettersOutsideFont, screenshotPath, stubTurnstile } from "./helpers";

const HEADLINE = "Cuando llegue el próximo incendio forestal, ¿estará lista su casa?";

const widest = (page: Page) =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll("main p, main h1, main h2, main h3, main li, main figcaption, main label, main button, main a, footer a, .language")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && !el.closest(".apart-box, .film") && (box.right > limit + 1 || box.left < -1);
      })
      .map((el) => (el.textContent ?? "").slice(0, 50));
    return { scroll: document.documentElement.scrollWidth, limit, over };
  });

const cardsOutOfView = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".card.on, .stat.on, .step.on")]
      .filter((el) => getComputedStyle(el).opacity !== "0")
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.height > innerHeight + 1;
      })
      .map((el) => (el.textContent ?? "").trim().slice(0, 50)),
  );

for (const [language, path, first] of [["es", "/?lang=es", HEADLINE], ["en", "/?lang=en", "When the next wildfire comes, will your home be ready?"]] as const) {
  test(`${language}: the page fits, top to bottom, and the choice is on the first screen`, async ({ page }, info) => {
    await stubTurnstile(page);
    await page.goto(path);
    await page.waitForLoadState("load");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("h1")).toHaveText(first);
    const choice = page.locator(".masthead .language");
    await expect(choice.locator("a")).toHaveText(["English", "Español"]);
    const box = (await choice.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const lockup = (await page.locator(".lockup").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(lockup.y + 1);
    const link = (await choice.locator("a").first().boundingBox())!;
    expect(link.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: screenshotPath(info, `language-${language}-top`) });

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const tall: string[] = [];
    for (let y = 0; y <= height; y += Math.round(page.viewportSize()!.height * 0.6)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(90);
      tall.push(...(await cardsOutOfView(page)));
    }
    expect([...new Set(tall)]).toEqual([]);
    const wide = await widest(page);
    expect(wide.scroll).toBeLessThanOrEqual(wide.limit);
    expect(wide.over).toEqual([]);

    await page.locator("#signup").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: screenshotPath(info, `language-${language}-form`) });
  });
}

test("Spanish: every choice works, and a Spanish phone gets Spanish on its own", async ({ page, browser }) => {
  await page.goto("/");
  await page.locator(".masthead .language a[lang='es']").click();
  await expect(page).toHaveURL(/\?lang=es$/);
  await expect(page.locator("h1")).toHaveText(HEADLINE);
  await page.locator(".masthead .language a[lang='en']").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const phone = await browser.newContext({ locale: "es-MX", baseURL: test.info().project.use.baseURL! });
  const spanish = await phone.newPage();
  await spanish.goto("/");
  await expect(spanish.locator("h1")).toHaveText(HEADLINE);
  await phone.close();
});

test("Spanish: the form answers in Spanish and the signup sends the language", async ({ page }) => {
  await stubTurnstile(page);
  const sent: string[] = [];
  await page.route("**/api/signup", async (route) => {
    sent.push(route.request().postData() ?? "");
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/?lang=es");
  await page.waitForFunction(() => (window as unknown as { __turnstile?: unknown }).__turnstile !== undefined);
  await page.locator("#email").fill("neighbor@example.com");
  await page.locator("#role").selectOption("homeowner");
  await page.locator("#signup button").click();
  await expect(page.locator("#signup-status")).toHaveText("Ya está en la lista. Le enviaremos un correo cuando EmberWalk salga.");
  expect(JSON.parse(sent[0]!).language).toBe("es");
});

for (const path of ["/", "/?lang=es"]) {
  test(`${path}: as shipped the one button to the app is on the page and goes to the app`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("a.app-link")).toHaveCount(1);
    await expect(page.locator('a[href*="go.emberwalk.app"]')).toHaveAttribute("href", "https://go.emberwalk.app");
  });
}

test("Spanish: the site's font holds every letter on the page", async ({ page }) => {
  await page.goto("/?lang=es");
  const text = await page.evaluate(() => document.body.textContent!.replace(/\s/g, ""));
  expect(await lettersOutsideFont(page, text)).toEqual([]);
});

test("Spanish: sets no cookie and stores nothing, on a visit, a choice and a signup", async ({ page, context }) => {
  await stubTurnstile(page);
  const answers: Promise<string | null>[] = [];
  const listen = (response: Response) => {
    const read = response.allHeaders().then((headers) => (headers["set-cookie"] === undefined ? null : response.url()), () => null);
    answers.push(Promise.race([read, new Promise<null>((done) => setTimeout(() => done(null), 3000))]));
  };
  page.on("response", listen);
  const signup = page.waitForResponse("**/api/signup");
  await page.goto("/");
  await page.locator(".masthead .language a[lang='es']").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.waitForFunction(() => (window as unknown as { __turnstile?: unknown }).__turnstile !== undefined);
  await page.locator("#email").fill("neighbor@example.com");
  await page.locator("#role").selectOption("homeowner");
  await page.locator("#signup button").click();
  expect((await signup).request().postDataJSON().language).toBe("es");
  await expect(page.locator("#signup-status")).toBeVisible();
  page.off("response", listen);
  expect((await Promise.all(answers)).filter((url) => url !== null)).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("Spanish: a legal page says plainly it is in English, and fits", async ({ page }, info) => {
  await page.goto("/privacy?lang=es");
  await expect(page.locator(".language-note")).toContainText("Esta página está disponible solo en inglés.");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const wide = await widest(page);
  expect(wide.scroll).toBeLessThanOrEqual(wide.limit);
  await page.screenshot({ path: screenshotPath(info, "language-es-privacy") });
  await page.locator(".language-note a").click();
  await expect(page.locator("h1")).toHaveText(HEADLINE);
});
