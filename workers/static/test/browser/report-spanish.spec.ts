import { RULES } from "@emberwalk/rules";
import { expect, test } from "@playwright/test";
import { PDF_OPTIONS, type ReportInput, reportHtml } from "../../../api/src/report.ts";
import { lettersOutsideFont, screenshotPath } from "./helpers";

const SPANISH_LETTERS = "áéíóúüñÁÉÍÓÚÜÑ¿¡";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LONG = "Mueva la pila de leña a más de 30 pies de la casa, o cúbrala con una lona resistente al fuego aprobada.";

const QUOTE = "A person that owns, leases, controls, operates, or maintains a building or structure in, upon, or adjoining a mountainous area shall at all times maintain defensible space.";

const finding = (n: number, over: object = {}) => ({
  id: id(n),
  concept: "wood_pile",
  band: "zone_1",
  distanceFeet: { low: 6, high: 9 },
  label: "required_now",
  instruction: LONG,
  sources: [{ citation: "PRC 4291 (a)(1)", words: QUOTE, status: "in_force", url: "https://example.org/prc-4291", retrievedOn: "2026-10-24" }],
  confidence: 0.8,
  proof: { still: "", frame: 1, seconds: 1, marker: [0.1, 0.1, 0.2, 0.2] },
  voiceNote: null,
  ...over,
});

const report = (language: "en" | "es"): string =>
  reportHtml({
    language,
    results: {
      walkedOn: "2026-11-04",
      coverage: "not_checked",
      findings: [finding(1), finding(2, { band: "zone_0", distanceFeet: { low: 0, high: 0 } }), finding(3, { band: "zone_2", label: "recommended", distanceFeet: { low: 40, high: 50 } }), finding(4)],
      gaps: [{ side: "back", kind: "first_five_feet", hint: "tilt_down" }],
      notChecked: ["propane_cylinder"],
    },
    statuses: new Map([[id(1), "done"], [id(2), "fix_planned"]]),
    marks: [{ findingId: id(1), status: "done", doneOn: "2026-11-05", markedAt: "2026-11-05T09:00:00.000Z" }],
    rechecks: [{ findingId: id(1), result: "unsure", createdAt: "2026-11-06T09:00:00.000Z" }],
    stills: new Map(),
    removed: new Set([id(4)]),
    approvedAt: "2026-11-07T10:00:00.000Z",
    templates: new Map(),
    personal: [],
  } as unknown as ReportInput);

for (const language of ["es", "en"] as const) {
  test(`${language} report fits with nothing past the edge, and prints`, async ({ page }, info) => {
    await page.setContent(report(language));
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    const fit = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll("main *")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > limit + 1 || box.left < -1);
        })
        .map((el) => (el.textContent ?? "").slice(0, 50));
      return { scroll: document.documentElement.scrollWidth, limit, over };
    });
    expect(fit.scroll).toBeLessThanOrEqual(fit.limit);
    expect(fit.over).toEqual([]);
    await page.screenshot({ path: screenshotPath(info, `report-${language}`), fullPage: true });
    const pdf = await page.pdf(PDF_OPTIONS);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });
}

test("the report's own fonts hold every letter of the Spanish report and of every Spanish rule line", async ({ page }) => {
  await page.setContent(report("es"));
  const text = await page.evaluate(() => document.body.innerText.replace(/\s/g, ""));
  const rules = RULES.flatMap((rule) => [rule.plain.es, rule.unsure?.es ?? ""]).join("").replace(/\s/g, "");
  expect(await lettersOutsideFont(page, `${text}${rules}${SPANISH_LETTERS}`)).toEqual([]);
});

test("the font check can fail: it reports a letter the report's fonts do not hold", async ({ page }) => {
  await page.setContent(report("es"));
  expect(await lettersOutsideFont(page, "«")).toEqual(["400 «", "700 «"]);
});
