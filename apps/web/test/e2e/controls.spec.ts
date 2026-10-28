import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { copy } from "../../src/copy.ts";
import { ROUTES } from "../../src/router.ts";

const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

type Saved = {
  handlers: string[];
  sound: boolean;
  jurisdiction: string | null;
  marks: { soundOffAtMs: number | null; pauses: unknown[]; propertyLines: number[]; motion: unknown[] };
};

const savedTake = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Saved>((resolve, reject) => {
        const open = indexedDB.open("emberwalk", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(["takes", "chunks"]);
          const takes = tx.objectStore("takes").getAll();
          const chunks = tx.objectStore("chunks").getAll();
          tx.oncomplete = () => {
            const take = takes.result[0];
            const parts = chunks.result.map((c: { data: ArrayBuffer }) => new Uint8Array(c.data));
            const bytes = new Uint8Array(parts.reduce((n: number, p: Uint8Array) => n + p.length, 0));
            let at = 0;
            for (const part of parts) {
              bytes.set(part, at);
              at += part.length;
            }
            const handlers: string[] = [];
            for (let i = 0; i + 16 <= bytes.length; i += 1) {
              if (String.fromCharCode(...bytes.slice(i, i + 4)) === "hdlr") handlers.push(String.fromCharCode(...bytes.slice(i + 12, i + 16)));
            }
            resolve({ handlers, sound: take.sound, jurisdiction: take.jurisdiction, marks: take.marks });
          };
        };
      }),
  );

const SILENCE = 0.001;

type Loudness ={ before: number; after: number; seconds: number };

const loudnessAround = (page: Page, atMs: number) =>
  page.evaluate(
    (splitMs) =>
      new Promise<Loudness>((resolve, reject) => {
        const open = indexedDB.open("emberwalk", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const chunks = open.result.transaction("chunks").objectStore("chunks").getAll();
          chunks.onsuccess = async () => {
            const blob = new Blob(chunks.result.map((c: { data: ArrayBuffer }) => c.data));
            const audio = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
            const samples = audio.getChannelData(0);
            const split = Math.round((splitMs / 1000) * audio.sampleRate);
            const margin = Math.round(0.2 * audio.sampleRate);
            const peak = (from: number, to: number) => samples.subarray(from, to).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
            resolve({ before: peak(0, split - margin), after: peak(split + margin, samples.length), seconds: audio.duration });
          };
        };
      }),
    atMs,
  );

const recordFor = async (page: Page, ms: number, during: () => Promise<void> = async () => undefined) => {
  await page.getByRole("button", { name: copy.record.start }).click();
  await expect(page.locator("video.preview")).toBeVisible();
  await page.waitForTimeout(ms);
  await during();
  await page.getByRole("button", { name: copy.record.stop }).click();
  await expect(page).toHaveURL(new RegExp(`${ROUTES.send}$`));
};

const WALK_PERMISSIONS = ["camera", "microphone", "accelerometer", "gyroscope", "magnetometer"];

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(WALK_PERMISSIONS);
});

test("a walk with sound keeps a sound track", async ({ page }) => {
  await page.goto(`/${ROUTES.record}`);
  await recordFor(page, 1500);
  const take = await savedTake(page);
  expect(take.sound).toBe(true);
  expect(take.handlers).toContain("vide");
  expect(take.handlers).toContain("soun");
});

test("Sound Off before the walk leaves no sound track in the saved take", async ({ page }) => {
  await page.goto(`/${ROUTES.record}`);
  const soundOff = page.getByRole("button", { name: copy.record.soundOff });
  await soundOff.click();
  await expect(soundOff).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(sideways)).toBe(0);
  await recordFor(page, 1500);
  const take = await savedTake(page);
  expect(take.sound).toBe(false);
  expect(take.handlers).toContain("vide");
  expect(take.handlers).not.toContain("soun");
});

test("Sound Off during a walk leaves only silence in the sound track from that moment", async ({ page }) => {
  await page.goto(`/${ROUTES.record}`);
  await recordFor(page, 2500, async () => {
    await page.getByRole("button", { name: copy.record.soundOff }).click();
    await page.waitForTimeout(2500);
  });
  const take = await savedTake(page);
  expect(take.marks.soundOffAtMs).toBeGreaterThan(2000);
  const loudness = await loudnessAround(page, take.marks.soundOffAtMs ?? 0);
  expect(loudness.seconds).toBeGreaterThan(4);
  expect(loudness.before).toBeGreaterThan(0.01);
  expect(loudness.after).toBeLessThan(SILENCE);
});

test("Pause, Sound Off, Property Line and the outline during a walk, with no sideways scroll", async ({ page }) => {
  await page.goto(`/${ROUTES.record}`);
  await recordFor(page, 800, async () => {
    expect(await page.evaluate(sideways)).toBe(0);
    await expect(page.locator("svg.outline")).toHaveAttribute("data-corners", "0");
    await page.evaluate(async () => {
      for (const alpha of [0, 300, 230, 170]) {
        window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha, beta: 80, gamma: 0 }));
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await expect(page.locator("svg.outline")).toHaveAttribute("data-corners", "2");
    await page.getByRole("button", { name: copy.record.propertyLine }).click();
    await page.getByRole("button", { name: copy.record.pause }).click();
    await expect(page.getByRole("button", { name: copy.record.propertyLine })).toBeDisabled();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: copy.record.pause }).click();
    await page.getByRole("button", { name: copy.record.soundOff }).click();
    await expect(page.getByRole("button", { name: copy.record.soundOff })).toBeDisabled();
    await page.waitForTimeout(600);
  });
  const { marks } = await savedTake(page);
  expect(marks.pauses).toHaveLength(1);
  expect(marks.propertyLines).toHaveLength(1);
  expect(marks.soundOffAtMs).toBeGreaterThan(0);
  expect(marks.motion.length).toBeGreaterThanOrEqual(3);
});

test("the walk keeps the rules found from location, with no question", async ({ page, context }) => {
  await context.grantPermissions([...WALK_PERMISSIONS, "geolocation"]);
  await context.setGeolocation({ latitude: 38.58, longitude: -121.49 });
  await page.goto(`/${ROUTES.record}`);
  expect(await page.evaluate(sideways)).toBe(0);
  await recordFor(page, 1000);
  await expect(page.getByRole("radio")).toHaveCount(0);
  expect((await savedTake(page)).jurisdiction).toBe("ca");
});

test("a refused location still records a walk and asks nothing about rules", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError);
  });
  await page.goto(`/${ROUTES.record}`);
  await recordFor(page, 1000);
  await expect(page.getByRole("radio")).toHaveCount(0);
  expect(await page.evaluate(sideways)).toBe(0);
  expect((await savedTake(page)).jurisdiction).toBeNull();
});
