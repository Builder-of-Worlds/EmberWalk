import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

const savedTake = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ takes: number; bytes: number; mimeType: string; endedBy: string; head: string }>((resolve, reject) => {
        const open = indexedDB.open("emberwalk", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(["takes", "chunks"]);
          const takes = tx.objectStore("takes").getAll();
          const chunks = tx.objectStore("chunks").getAll();
          tx.oncomplete = () => {
            const take = takes.result[0];
            const first = new Uint8Array(chunks.result[0]?.data ?? new ArrayBuffer(0));
            resolve({
              takes: takes.result.length,
              bytes: take?.bytes ?? 0,
              mimeType: take?.mimeType ?? "",
              endedBy: take?.endedBy ?? "",
              head: String.fromCharCode(...first.slice(4, 8)),
            });
          };
        };
      }),
  );

test("records a walk from the rear camera and keeps it on the phone as MP4", async ({ page, context }) => {
  await context.grantPermissions(["camera", "microphone"]);
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("left");
  expect(await page.evaluate(sideways)).toBe(0);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTES.send}$`));
  await expect(page.getByRole("status")).toHaveText(copy.send.saved);
  const take = await savedTake(page);
  expect(take.takes).toBe(1);
  expect(take.bytes).toBeGreaterThan(1000);
  expect(take.mimeType).toMatch(/^video\/mp4/);
  expect(take.endedBy).toBe("stopped");
  expect(take.head).toBe("ftyp");
  expect(await page.evaluate(sideways)).toBe(0);
});

test("explains a refused camera", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.record.denied);
  await expect(page.getByRole("button", { name: copy.record.tryAgain })).toBeVisible();
  expect(await page.evaluate(sideways)).toBe(0);
});

test("explains a browser that cannot record", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", { value: undefined });
  });
  await page.goto(`/${ROUTES.record}`);
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.record.unsupported);
  expect(await page.evaluate(sideways)).toBe(0);
});
