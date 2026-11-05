import type { ResultFinding } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { type ReportInput, reportHtml } from "../src/report.ts";
import { CONCEPT_WORDS, reportWords } from "../src/report-words.ts";
import { reportWordsEs } from "../src/report-words-es.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const QUOTE = "Clear flammable vegetation within 30 feet.";

const finding = (n: number, over: Partial<ResultFinding> = {}): ResultFinding =>
  ({
    id: id(n),
    concept: "wood_pile",
    band: "zone_1",
    distanceFeet: { low: 6, high: 9 },
    label: "required_now",
    instruction: `Mueva la leña ${n}.`,
    sources: [{ citation: "PRC 4291 (a)(1)", words: QUOTE, status: "in_force", url: "https://example.org/prc-4291", retrievedOn: "2026-10-24" }],
    confidence: 0.8,
    proof: { still: `/api/walks/${id(9)}/stills/${id(n)}`, frame: 1, seconds: 1, marker: [0.1, 0.1, 0.2, 0.2] },
    voiceNote: null,
    ...over,
  }) as ResultFinding;

const input = (over: Partial<ReportInput> = {}, results: Partial<ReportInput["results"]> = {}): ReportInput => ({
  results: { walkedOn: "2026-11-04", findings: [finding(1)], gaps: [], notChecked: [], coverage: "checked", ...results },
  statuses: new Map(),
  marks: [],
  rechecks: [],
  stills: new Map(),
  removed: new Set(),
  approvedAt: null,
  templates: new Map(),
  personal: [],
  language: "es",
  ...over,
});

const FULL = (language: "en" | "es"): ReportInput =>
  input(
    {
      language,
      approvedAt: "2026-11-05T10:00:00.000Z",
      removed: new Set([id(5)]),
      statuses: new Map([[id(1), "done"], [id(2), "fix_planned"], [id(3), "needs_fixing"], [id(4), "done"]]),
      marks: [
        { findingId: id(1), status: "done", doneOn: "2026-11-05", markedAt: "2026-11-05T09:00:00.000Z" },
        { findingId: id(4), status: "done", doneOn: "2026-11-05", markedAt: "2026-11-05T09:00:00.000Z" },
      ],
      rechecks: [
        { findingId: id(4), result: "cleared", createdAt: "2026-11-06T09:00:00.000Z" },
        { findingId: id(1), result: "still_there", createdAt: "2026-11-06T09:00:00.000Z" },
        { findingId: id(1), result: "unsure", createdAt: "2026-11-07T09:00:00.000Z" },
      ],
    },
    {
      coverage: "not_checked",
      findings: [finding(1), finding(2, { band: "zone_0" }), finding(3, { band: "zone_2", label: "recommended", distanceFeet: { low: 40, high: 50 } }), finding(4), finding(5, { distanceFeet: { low: 0, high: 0 } })],
      gaps: [{ side: "back", kind: "dark", hint: "more_light" } as never, { side: "left", kind: "missing", hint: "walk_side" } as never, { side: "front", kind: "first_five_feet", hint: "tilt_down" } as never, { side: "right", kind: "not_checked", hint: "again" } as never],
      notChecked: ["propane_tank"],
    },
  );

const visible = (html: string): string => html.replace(/<style>.*<\/style>/s, "").replace(/<[^>]+>/g, "\n");

const leaves = (value: unknown): string[] =>
  typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(leaves) : [];

describe("the report in Spanish", () => {
  it("is marked Spanish, and English stays English by default", () => {
    expect(reportHtml(input())).toContain('<html lang="es">');
    const plain = input();
    delete plain.language;
    expect(reportHtml(plain)).toContain('<html lang="en">');
    expect(reportHtml(plain)).toContain(reportWords.title);
  });

  it("shows no English line anywhere outside the quoted rule", () => {
    const english = visible(reportHtml(FULL("en")));
    const spanish = visible(reportHtml({ ...FULL("es") })).replaceAll(QUOTE, "");
    const words = leaves(reportWords).filter((line) => line.length > 3 && !leaves(reportWordsEs).includes(line));
    expect(words.length).toBeGreaterThan(20);
    for (const line of words) if (english.includes(line)) expect(spanish, line).not.toContain(line);
    expect(spanish).not.toMatch(/\b(?:Walked|Rechecked|Against the house|feet from|Needs Fixing|Fix Planned|side|Page)\b/);
    expect(spanish).not.toMatch(/\b(?:January|February|March|April|June|July|August|September|October|November|December|Nov\.|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/);
  });

  it("carries the walk's own instruction and every date in Spanish", () => {
    const page = reportHtml(FULL("es"));
    expect(page).toContain("Mueva la leña 1.");
    expect(page).toContain("miércoles, 4 de noviembre de 2026");
    expect(page).toContain("7 de noviembre de 2026");
    expect(page).toContain(`Revisado de nuevo el 7 de noviembre de 2026, la foto nueva no era lo bastante clara para mostrarlo: Mueva la leña 1.`);
  });

  it("says the sides of the house in Spanish, with the reviewed sentences", () => {
    const page = reportHtml(FULL("es"));
    expect(page).toContain("El lado trasero está demasiado oscuro para revisarlo.");
    expect(page).toContain("El lado izquierdo todavía no está en su video.");
    expect(page).toContain("Los primeros cinco pies del lado frontal todavía no se ven.");
    expect(page).toContain("Todavía falta revisar el lado derecho.");
    expect(page).toContain("Sin revisar en este recorrido: tanques de propano.");
  });

  it("keeps the fix first list and names the missed side and corner in each language", () => {
    const gaps = [{ side: "left", kind: "missing", hint: "walk_side" } as never, { side: "back_left", kind: "missing", hint: "pan_corner" } as never];
    const spanish = input({ language: "es" }, { coverage: "not_checked", gaps, findings: [finding(1), finding(2)] });
    const page = reportHtml(spanish);
    expect(page).toContain('data-part="fix-first"');
    expect(page).toContain("Arregle estas 2 cosas primero");
    expect(page).toContain("La esquina trasera izquierda todavía no está en su video.");
    const english = reportHtml(input({ language: "en" }, { coverage: "not_checked", gaps, findings: [finding(1), finding(2)] }));
    expect(english).toContain("Fix These 2 First");
    expect(english).toContain("The back left corner isn&#39;t in your video yet.");
  });

  it("names every concept in Spanish", () => {
    expect(Object.keys(reportWordsEs.conceptWords).sort()).toEqual(Object.keys(CONCEPT_WORDS).sort());
    for (const [concept, words] of Object.entries(reportWordsEs.conceptWords)) expect(words, concept).not.toBe(CONCEPT_WORDS[concept as keyof typeof CONCEPT_WORDS]);
  });

  it("keeps the same figures as the English in lines that hold a number", () => {
    expect(reportWordsEs.distance(6, 9)).toBe("Aproximadamente de 6 a 9 pies de la casa.");
    expect(reportWordsEs.distance(0, 0)).toBe("Tocando la casa.");
    expect(reportWordsEs.distance(0, 1)).toBe("A 1 pie o menos de la casa.");
    expect(reportWordsEs.distance(3, 3)).toBe("A más o menos 3 pies de la casa.");
    expect(reportWordsEs.fixFirst(1)).toBe("Arregle esto primero");
    expect(reportWordsEs.fixFirst(3)).toBe("Arregle estas 3 cosas primero");
    expect(reportWordsEs.zoneZero).toContain("5 pies");
  });

  it("removedItem reads as one sentence, lowered after the comma", () => {
    expect(reportWordsEs.removedItem("wood_pile", 0, 0)).toBe("Pilas de leña, tocando la casa.");
  });

  it("keeps every rule's quote in English, marked as English and labelled as the official English text", () => {
    const page = reportHtml(input());
    expect(page).toContain(`<p>${reportWordsEs.quoteLabel}</p><p lang="en">${QUOTE}</p>`);
    expect(reportWordsEs.quoteLabel).toMatch(/inglés/);
    expect(reportHtml(input({ language: "en" }))).toContain(`<p>${QUOTE}</p>`);
    expect(reportHtml(input({ language: "en" }))).not.toContain('<p lang="en">');
  });

  it("prints Spanish in the page footer", () => {
    const page = reportHtml(input());
    expect(page).toMatch(/@bottom-center\{content:"Registro de espacio defendible {4}Recorrido hecho 4 de noviembre de 2026 {4}Página " counter\(page\) " de " counter\(pages\) "\\A EmberWalk no es una inspección ni una certificación\."/);
  });
});
