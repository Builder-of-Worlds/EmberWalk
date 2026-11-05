import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { judgeWords } from "../../src/judge.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const JUDGE_DIST = new URL("../../dist/judge/", import.meta.url);

const jpegWidth = (bytes: Buffer): number => {
  for (let at = 2; at + 9 < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    const marker = bytes.readUInt8(at + 1);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return bytes.readUInt16BE(at + 7);
  }
  throw new Error("no JPEG frame header");
};

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

  await page.getByRole("link", { name: judgeWords.resultsButton }).click();
  await expect(page.locator("main.results")).toHaveAttribute("data-verdict", "fix");
  await expect(page.locator(".sample-strip")).toHaveText(judgeWords.label);
  const photo = page.locator(".proof img").first();
  await expect(photo).toBeVisible();
  const served = new URL(await photo.evaluate((img: HTMLImageElement) => img.currentSrc));
  expect(served.origin).toBe(origin);
  expect(served.pathname.startsWith("/judge/stills/"), served.pathname).toBe(true);
  const width = jpegWidth(await readFile(new URL(served.pathname.slice("/judge/".length), JUDGE_DIST)));
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(width);
  expect(page.viewportSize()?.width).toBe(390);
  expect(await page.evaluate(sideways)).toBe(0);

  await page.getByRole("button", { name: copy.results.detailed }).click();
  await expect(page.locator(".citations li").first()).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);

  await page.locator("li.finding a").first().click();
  await expect(page.locator("main.one-finding")).toBeVisible();
  await expect(page.locator(".sample-strip")).toHaveText(judgeWords.label);
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
  await page.getByRole("link", { name: judgeWords.resultsButton }).click();
  await expect(page.locator("main.results")).toHaveAttribute("data-verdict", "fix");
  await expect(page.locator(".proof img").first()).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
  await context.setOffline(false);
});
