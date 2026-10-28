import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

test("the judge copy opens from a folder with no request outside it, then works offline, at 390 px", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const asked: string[] = [];
  context.on("request", (request) => asked.push(request.url()));

  await page.goto("/judge/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null)
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });

  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  const photo = page.locator(".proof img");
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(960);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("button", { name: copy.results.detailed }).click();
  await expect(page.locator(".citations li").first()).toBeVisible();
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.locator("li.finding a").first().click();
  await expect(page.locator("main.one-finding")).toBeVisible();
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);

  expect(asked.length).toBeGreaterThan(0);
  for (const url of asked.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:"))) {
    expect(new URL(url).origin, url).toBe(origin);
    expect(new URL(url).pathname.startsWith("/judge/"), url).toBe(true);
    expect(new URL(url).pathname.includes("/api/"), url).toBe(false);
  }

  await context.setOffline(true);
  await page.goto("/judge/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.home.title);
  await page.getByRole("link", { name: copy.home.sample }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.results.incomplete);
  await expect(page.getByText(/synthetic/i)).toHaveCount(0);
  await expect(page.locator(".proof img")).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  await context.setOffline(false);
});
