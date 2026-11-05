import { expect, test } from "@playwright/test";

test("the home page shows the plans' prices and a link to them, in the words the pricing page uses", async ({ page, request }) => {
  await page.goto("/");
  const pricing = await request.get("/pricing");
  const summary = /<meta name="description" content="([^"]+)"/.exec(await pricing.text())![1]!;
  const closing = page.locator("#early-access");
  await expect(closing.locator("p.prices")).toHaveText(summary);
  const place = await closing.locator("p.prices").evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { align: getComputedStyle(el).textAlign, middle: box.left + box.width / 2, page: document.documentElement.clientWidth / 2 };
  });
  expect(["left", "start"], "the price paragraph runs left aligned").toContain(place.align);
  expect(Math.abs(place.middle - place.page), "in a centered column").toBeLessThanOrEqual(2);
  const link = closing.locator('a.button[href="/pricing"]');
  await expect(link).toHaveText("Plans and Pricing");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.locator("main")).toContainText("Plans go on sale when EmberWalk launches.");
  await expect(page.locator("main")).not.toContainText(/Nov\. 4th/);
});

test("the Spanish home page says the prices and the link in Spanish, and leaves its sign up note left aligned", async ({ page }) => {
  await page.goto("/?lang=es");
  const closing = page.locator("#early-access");
  await expect(closing.locator("p.prices")).toContainText("Dos planes anuales de EmberWalk: $12.99");
  await expect(closing.locator('a.button[href^="/pricing"]')).toHaveText("Planes y precios (en inglés)");
  const align = await closing.locator("p.fine", { hasText: "Le enviaremos correos" }).evaluate((el) => getComputedStyle(el).textAlign);
  expect(["left", "start"]).toContain(align);
});

test("the Plans and Pricing button keeps its words readable when hovered", async ({ page }, info) => {
  await page.goto("/");
  const link = page.locator("a.button.plans");
  await link.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  if (info.project.name === "1440") await link.hover();
  await page.waitForTimeout(600);
  const shown = await link.evaluate((el) => {
    const css = getComputedStyle(el);
    return { color: css.color, back: css.backgroundColor };
  });
  const channels = (rgb: string) => rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const light = (rgb: string) => {
    const [r, g, b] = channels(rgb).map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [a, b] = [light(shown.color), light(shown.back)].sort((x, y) => y - x);
  expect((a! + 0.05) / (b! + 0.05), JSON.stringify(shown)).toBeGreaterThanOrEqual(4.5);
});

for (const route of ["/", "/?lang=es"]) {
  test(`at ${route} the regulation is cited once, on the rule card, not again on the insurance card`, async ({ page }) => {
    await page.goto(route);
    const html = await page.content();
    expect(html.split("2644.9").length - 1).toBe(1);
    expect(await page.locator("#stats .stat.plain").textContent()).toContain("2644.9");
    expect(await page.locator("section.tone-umber").textContent()).not.toMatch(/2644\.9|Safer from Wildfires/);
  });
}

test("/favicon.ico answers with the brand icon", async ({ request }) => {
  const icon = await request.get("/favicon.ico");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
  const brand = await request.get("/brand/icon-32.png");
  expect((await icon.body()).equals(await brand.body())).toBe(true);
});

test("the content policy lets no analytics script run, so the privacy page stays true", async ({ request }) => {
  const policy = (await request.get("/")).headers()["content-security-policy"] ?? "";
  expect(policy).not.toMatch(/cloudflareinsights/);
});
