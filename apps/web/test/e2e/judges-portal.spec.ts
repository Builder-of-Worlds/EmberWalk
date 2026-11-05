import { expect, test } from "@playwright/test";
import { judgeResult } from "../../build/hero-sample.ts";
import { judgeWords as words, TRUTH_SAMPLE_ID } from "../../src/judge.ts";
import { sideways } from "./geometry.ts";

const result = judgeResult();

const BROKEN = /Something went wrong|isn't in your video yet|Walk My House|See a Sample House|October 26|Oct\. 26/;

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test.describe(`the judges' portal at ${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
    });

    test("the judges' video button is the first thing at the top, inside the first screen, and it plays", async ({ page }) => {
      await page.goto("/");
      const first = page.locator("main.portal").getByRole("button").first();
      await expect(first).toHaveText(words.video);
      await page.waitForTimeout(2500);
      await expect(page.locator("main.portal")).not.toContainText(/\byour\b/i);
      await page.screenshot({ path: test.info().outputPath("landing.png") });
      await page.screenshot({ path: test.info().outputPath("landing-full.png"), fullPage: true });
      const box = await first.boundingBox();
      expect(box!.y + box!.height).toBeLessThan(height);
      const language = await page.locator(".language").boundingBox();
      expect(language!.y, "the video comes before the language bar").toBeGreaterThanOrEqual(box!.y + box!.height);
      await first.click();
      const film = page.locator(".film video");
      await expect(film).toBeVisible();
      await expect.poll(() => film.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      expect(await film.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(170);
      expect(await page.evaluate(sideways)).toBe(0);
    });

    test("a mouse-driven browser reads the portal at the app's own text size, not the Mac's smaller system text", async ({ page }) => {
      await page.goto("/");
      expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
    });

    test("the walk is labelled a synthetic sample house, fills the phone's width, and names each corner stop", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".portal-walk .portal-label")).toHaveText("Synthetic sample house");
      await page.getByRole("link", { name: words.walkButton }).click();
      await expect(page.locator(".judge-walk .portal-label")).toHaveText("Synthetic sample house");
      const video = page.locator(".walk-stage video");
      await expect(video).toBeVisible();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      const box = await video.boundingBox();
      const sizes = await page.evaluate(() => {
        const w = (selector: string) => Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? -1);
        const probe = Object.assign(document.createElement("div"), { style: "position:fixed;height:100svh" });
        document.body.append(probe);
        const svh = probe.getBoundingClientRect().height;
        probe.remove();
        const app = document.querySelector(".app")!;
        const style = getComputedStyle(app);
        return `window ${innerWidth}x${innerHeight}, 100svh ${svh}, .app ${w(".app")} (route ${app.getAttribute("data-route")}, max-width ${style.maxWidth}, padding ${style.paddingLeft}, :has(.judge-walk) ${app.matches(":has(.judge-walk)")}), stage ${w(".walk-stage")}, video ${w(".walk-stage video")}`;
      });
      expect(box!.width, sizes).toBeGreaterThanOrEqual(Math.min(width, 1200) - 40);
      if (width === 390) expect(box!.height).toBeGreaterThan(450);
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 12;
      });
      expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeLessThanOrEqual(90);
      expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThanOrEqual(60);
      await expect(page.locator(".walk-line")).toHaveText(words.panning("left"));
      expect((await page.getByRole("button", { name: words.fullScreen }).boundingBox())!.width).toBeLessThanOrEqual(760);
      await page.screenshot({ path: test.info().outputPath("walk.png") });
      expect(await page.evaluate(sideways)).toBe(0);
    });

    test("the walk plays the phone file on an upright screen, the desktop file on a wide one, and swaps when the screen turns", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL: baseURL!, viewport: { width, height }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.route("**/walk/phone/**", async (route) => {
        const whole = await route.fetch({ url: route.request().url().replace("/walk/phone/", "/walk/desktop/") });
        await route.fulfill({ response: whole });
      });
      let last = "";
      page.on("request", (request) => {
        const part = /\/walk\/(phone|desktop)\/.*\.m4s/.exec(request.url());
        if (part !== null) last = part[1]!;
      });
      await page.goto("/#/record");
      const video = page.locator(".walk-stage video");
      const [first, turned] = width === 390 ? ["phone", "desktop"] : ["desktop", "phone"];
      await expect.poll(() => last).toBe(first);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 20;
      });
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(20);
      await page.setViewportSize({ width: height, height: width });
      await expect.poll(() => last).toBe(turned);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
      expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime), "turning the screen keeps the place").toBeGreaterThanOrEqual(20);
      expect(await page.evaluate(sideways)).toBe(0);
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    });

    test("the walk and the film really move, frame by frame, in this browser", async ({ page }) => {
      await page.goto("/#/record");
      const walk = page.locator(".walk-stage video");
      await expect.poll(() => walk.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(1);
      await page.goto("/");
      await page.locator("main.portal").getByRole("button", { name: words.video }).click();
      const film = page.locator(".film video");
      await expect(film.locator("track"), "the film's picture carries its captions, so the player offers no second set").toHaveCount(0);
      await film.evaluate((v: HTMLVideoElement) => {
        v.muted = true;
        void v.play();
      });
      await expect.poll(() => film.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(1);
    });

    test("with no phone walk built yet, an upright screen plays the desktop walk and says nothing failed", async ({ browser, baseURL }) => {
      for (const native of [true, false]) {
        const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
        const page = await context.newPage();
        await page.route("**/walk/phone/**", (route) => route.fulfill({ status: 404, body: "" }));
        if (!native) {
          await page.addInitScript(() => {
            HTMLMediaElement.prototype.canPlayType = () => "";
          });
        }
        await page.goto("/#/record");
        const video = page.locator(".walk-stage video");
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThan(0);
        await expect(page.locator(".judge-walk")).not.toContainText(words.walkFailed);
        await context.close();
      }
    });

    test("the film says so when it cannot load, and Escape closes it", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL: baseURL!, viewport: { width, height }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.route("**/film/**", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto("/");
      await page.locator("main.portal").getByRole("button", { name: words.video }).click();
      await expect(page.locator(".film [role=status]")).toHaveText(words.filmFailed);
      await page.keyboard.press("Escape");
      await expect(page.locator(".film")).toHaveCount(0);
      await context.close();
    });

    test("the direct film link opens the portal with the film player already open on the film, and closing it leaves a working page", async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL: baseURL!, viewport: { width, height }, serviceWorkers: "block" });
      const page = await context.newPage();
      const asked: string[] = [];
      page.on("request", (request) => asked.push(new URL(request.url()).pathname));
      await page.goto("/#film");
      const film = page.locator(".film video");
      await expect(film).toBeVisible();
      await expect.poll(() => asked.some((path) => path.endsWith("/film/master.m3u8"))).toBe(true);
      await expect.poll(() => film.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      const close = page.locator(".film").getByRole("button", { name: words.close });
      await expect(close).toBeVisible();
      expect(await page.evaluate(sideways)).toBe(0);
      await close.click();
      await expect(page.locator(".film")).toHaveCount(0);
      expect(new URL(page.url()).hash).not.toBe("#film");
      await page.locator("main.portal").getByRole("button", { name: words.video }).click();
      await expect(page.locator(".film video")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: words.walkButton }).click();
      await expect(page.locator(".judge-walk")).toBeVisible();
      await context.close();
    });

    test("a browser with no HLS of its own plays both videos through hls.js", async ({ page }) => {
      await page.addInitScript(() => {
        HTMLMediaElement.prototype.canPlayType = () => "";
      });
      await page.goto("/#/record");
      const video = page.locator(".walk-stage video");
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      expect(await video.evaluate((v: HTMLVideoElement) => v.src)).toMatch(/^blob:/);
      await page.goto("/");
      await page.locator("main.portal").getByRole("button", { name: words.video }).click();
      const film = page.locator(".film video");
      await expect.poll(() => film.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      expect(await film.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(170);
    });

    test("the record screen's way back says where it goes", async ({ page }) => {
      await page.goto("/#/history");
      await expect(page.locator("main.history a.button").last()).toHaveText("Back to Home");
    });

    test("the portal's own words follow the language switch", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Español" }).click();
      await expect(page.getByRole("button", { name: "Ver el Video para el Jurado" })).toBeVisible();
      await expect(page.locator(".portal-walk .portal-label")).toHaveText("Casa de muestra sintética");
      expect(await page.evaluate(sideways)).toBe(0);
      await page.goto(`/#/results/${result.id}`);
      await expect(page.locator("main li.finding a").first()).toBeVisible();
      const shown = await page.locator("main li.finding a").allInnerTexts();
      const english = result.findings.map((f) => f.instruction);
      expect(shown.filter((line) => english.some((en) => line.includes(en))), "every hazard sentence is in Spanish").toEqual([]);
    });

    test("the walk ends through the checking steps on a complete result, Simple and Detailed both full", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/#/record");
      const video = page.locator(".walk-stage video");
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = v.duration - 0.2;
        void v.play();
      });
      await expect(page.locator("main.results")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("main.results")).toHaveAttribute("data-verdict", "fix");
      await expect(page.locator("main.results")).not.toContainText(BROKEN);
      if (result.id === TRUTH_SAMPLE_ID) await expect(page.locator("[data-part=truth]")).toHaveText(words.truth);
      else await expect(page.locator("[data-part=truth]")).toHaveCount(0);
      expect(await page.locator("main li.finding").count()).toBe(result.findings.length);
      await page.getByRole("button", { name: "Detailed" }).click();
      expect(await page.locator("main li.finding .citations").count()).toBe(result.findings.length);
      await page.screenshot({ path: test.info().outputPath("results.png") });
      for (const img of await page.locator("main li.finding .proof img").all()) {
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(sideways)).toBe(0);
    });

    test("every screen works with no sign-in and no API call", async ({ page, browserName }) => {
      test.setTimeout(120_000);
      const api: string[] = [];
      const thrown: string[] = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.includes("/api/")) api.push(r.url());
      });
      page.on("pageerror", (e) => thrown.push(e.message));
      let shots = 0;
      const clean = async () => {
        await expect(page.locator("body")).not.toContainText(BROKEN);
        await expect(page.locator("main")).not.toBeEmpty();
        expect(await page.evaluate(sideways)).toBe(0);
        await page.screenshot({ path: test.info().outputPath(`screen-${(shots += 1)}.png`), fullPage: true });
      };

      await page.goto(`/#/results/${result.id}`);
      await expect(page.locator("main.results")).toBeVisible();
      await page.locator(".band li.finding a").first().click();
      await expect(page.locator("main.one-finding")).toBeVisible();
      await clean();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.locator("form.note button[type=submit]").click();
      await expect(page.locator("[data-part=done-on]")).toBeVisible();
      await expect(page.locator("[data-part=status]").first(), "the status does not say Done twice").not.toContainText(/Done\s*Done/);

      await page.goto(`/#/fix/${result.id}`);
      await page.getByLabel("Your ZIP code").fill("95662");
      await page.getByRole("button", { name: "Find Licensed Crews" }).click();
      await expect(page.locator("section.job").first()).toBeVisible();
      await expect(page.locator("main.fix")).toContainText(words.crews);
      const jobLines = await page.locator("section.job ul.sentences li").allInnerTexts();
      expect(jobLines.length, "a job does not repeat a sentence").toBe(new Set(jobLines).size);
      await clean();
      await page.locator("section.job button.primary").first().click();
      await page.locator("section.job a.button.primary").first().click();
      await expect(page.locator("main.approve")).toBeVisible();
      await clean();
      await page.locator("main.approve button.primary").click();
      await page.locator("main.approve a.button").click();
      await expect(page.locator("[data-part=demo-inbox]").first()).toHaveText(words.inbox);
      await expect(page.locator("[data-part=reading]").first()).toBeVisible();
      await page.locator("form textarea").first().fill("Next Tuesday works.");
      await page.locator("form:has(textarea) button[type=submit]").first().click();
      await expect(page.locator(".said", { hasText: "Next Tuesday works." })).toBeVisible();
      expect(await page.locator("section[data-part=demo-inbox] .said").first().innerText(), "the inbox keeps the request's lines").toContain("\n- ");
      await page.locator("section.remind button").click();
      await expect(page.locator("section.remind [role=status]")).toBeVisible();
      await clean();
      await page.locator(".inspection-ask a.button").click();
      await expect(page.locator("main.inspection[data-ready=false]")).toContainText("Mark every Required Now item done first.");
      await clean();
      await page.getByRole("button", { name: words.markAll }).click();
      await expect(page.locator("main.inspection[data-ready=true]")).toBeVisible();
      await page.locator("main.inspection button.primary").click();
      await expect(page.locator("main.inspection")).toContainText("- ");
      const asked = (await page.locator("main.inspection").innerText()).split("\n").filter((line) => line.startsWith("- "));
      expect(asked.length, "the draft does not repeat a sentence").toBe(new Set(asked).size);
      await expect(page.locator("main.inspection [role=status]")).toBeVisible();
      await clean();

      await page.goto(`/#/report/${result.id}`);
      await expect(page.locator("main.report iframe")).toBeVisible();
      await clean();
      await page.locator("[data-part=approve]").click();
      await expect(page.locator("[data-part=download]")).toBeVisible();
      await expect(page.locator("main.report [data-part=share]")).toHaveCount(0);
      const download = page.waitForEvent("download");
      await page.locator("[data-part=download]").click();
      expect((await download).suggestedFilename()).toBe("emberwalk-sample-record.pdf");
      await clean();
      if (width === 1440 && browserName === "chromium") {
        const html = await page.locator("main.report iframe").getAttribute("srcdoc");
        const printed = await page.context().newPage();
        await printed.setContent(html ?? "");
        const pdf = await printed.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true, path: test.info().outputPath("report.pdf") });
        expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
        await printed.close();
      }

      await page.goto("/#/history");
      await expect(page.locator("section.record-walk")).toBeVisible();
      await expect(page.locator("[data-mark]").first()).toBeVisible();
      await clean();

      await page.goto("/#/about");
      await expect(page.locator("main.about")).toBeVisible();
      await clean();

      await page.locator("main.about button", { hasText: "Delete Everything" }).click();
      await page.locator("main.about button", { hasText: "Go Back" }).click();
      await page.locator("main.about a.button").click();
      await expect(page.locator("main.portal")).toBeVisible();

      await page.goto(`/#/recheck/${result.id}/${result.findings[0]!.id}`);
      await expect(page.locator("main.recheck")).toBeVisible();
      await page.getByRole("button", { name: words.recheckUse }).click();
      await expect(page.locator("[data-part=sample-answer]")).toHaveText(words.recheckAnswer);
      await expect(page.locator("main"), "the photo here is the sample's").not.toContainText("your new photo");
      await clean();
      await page.locator("main.recheck [data-part=back]").click();
      await expect(page.locator("main.results")).toBeVisible();

      await page.locator(".band li.finding a").first().click();
      await page.getByRole("button", { name: "Simple" }).click();
      await page.getByRole("button", { name: "Detailed" }).click();
      await page.locator("main.one-finding button[aria-controls=more]").click();
      await expect(page.locator("#more .sources a").first()).toBeVisible();
      await clean();
      await page.locator("#more button").last().click();
      await expect(page.locator(".removed")).toBeVisible();
      await page.locator(".removed button").click();

      await page.goto("/#/how");
      await expect(page.locator("main li").first()).toBeVisible();
      await clean();
      await page.locator("main button.primary").click();
      await expect(page.locator("main.judge-walk")).toBeVisible();

      await page.goto("/#/send");
      await expect(page.locator("main.portal"), "there is no recording to send here, so Send opens the portal").toBeVisible();

      for (const [name, screen] of [
        [words.screens.how, "main li"],
        [words.screens.results, "main.results"],
        [words.screens.fix, "main.fix"],
        [words.screens.report, "main.report"],
        [words.screens.history, "main.history"],
        [words.screens.about, "main.about"],
      ] as const) {
        await page.goto("/#/");
        await page.getByRole("link", { name, exact: true }).click();
        await expect(page.locator(screen).first()).toBeVisible();
        await clean();
      }

      await page.locator("main.about button", { hasText: "Delete Everything" }).click();
      await page.getByRole("button", { name: "Yes, Delete Everything" }).click();
      await expect(page.locator("main.about [role=status]")).toBeVisible();
      await clean();

      expect(api).toEqual([]);
      expect(thrown).toEqual([]);
    });
  });
}
