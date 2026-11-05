// @vitest-environment node
import { fileURLToPath } from "node:url";
import { CORNERS, GAP_HINTS, GAP_KINDS, LOOP_CONCEPTS, PipelineStep, SIDES } from "@emberwalk/shared";
import type { WalkState } from "@emberwalk/shared";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { copy, draft, longDate, unbacked, walkDate } from "../../src/copy.ts";
import { copyEs, draftEs, longDateEs, sidesEs, unbackedEs, walkDateEs } from "../../src/copy-es.ts";

const SAME_IN_BOTH = new Set(["EmberWalk"]);

const DAY = new Date(Date.UTC(2026, 9, 28, 12));

const STATES: WalkState[] = [{ name: "queued" }, ...PipelineStep.options.map((step) => ({ name: "processing", step }) as const)];

const sides = SIDES.map((side) => [side]);
const corners = CORNERS.map((corner) => [corner]);
const words = [["x"]];

const MESSAGES = [
  { status: "draft", channel: "email", outbox: null, sentAt: null },
  { status: "approved", channel: "text", outbox: null, sentAt: null },
  { status: "approved", channel: "email", outbox: { state: "failed" }, sentAt: null },
  { status: "approved", channel: "email", outbox: null, sentAt: null },
  { status: "sent", channel: "email", outbox: null, sentAt: "2026-10-28T20:00:00Z" },
  { status: "sent_by_phone", channel: "text", outbox: null, sentAt: "2026-10-28T20:00:00Z" },
  { status: "replied", channel: "email", outbox: null, sentAt: null },
];

const ARGS: Record<string, unknown[][]> = {
  "draft.fixed.itemsOnList": [[0], [1], [3]],
  "draft.fixed.distance": [[1, false], [2.34, true], [0.5, false]],
  "draft.fixed.license": [["Active", null], ["Active", "2026-10-28"]],
  "draft.fixed.emailOf": words,
  "draft.fixed.emailLabel": words,
  "draft.fixed.zipOutside": [["10001"]],
  "draft.fixed.message": MESSAGES.map((message) => [message]),
  "draft.fixed.price": words,
  "draft.fixed.date": words,
  "draft.fixed.reminderReady": words,
  "draft.fixed.reminderDue": words,
  "draft.fixed.problem": [["offline"], ["rate_limited"], ["conflict"], ["not_ready"], ["send_failed"], ["server_error"], ["unheard_of"]],
  "draft.approve.byEmail": [[null], ["a@b.co"]],
  "draft.approve.byText": words,
  "draft.approve.subject": words,
  "draft.inspection.subject": words,
  "draft.status.doneOn": [["2026-10-28"]],
  "draft.history.mark": [["x", "y"]],
  "draft.record.pan": sides,
  "draft.guided.now": sides,
  "draft.results.confidence": [[0.87], [1]],
  "draft.corners.gap.missing": corners,
  "draft.corners.gap.dark": corners,
  "draft.corners.gap.first_five_feet": corners,
  "draft.corners.gap.not_checked": corners,
  "draft.corners.hint": corners,
  "draft.corners.panCorner": corners,
  "draft.corners.pan": corners,
  "draft.corners.oneCorner": corners,
  "unbacked.pin.side": sides,
  "copy.results.gap": SIDES.flatMap((side) => GAP_KINDS.map((kind) => [{ side, kind, hint: "walk_side" }])),
  ...Object.fromEntries(GAP_HINTS.map((hint) => [`copy.results.hint.${hint}`, sides])),
  "copy.results.walkSide": sides,
  "copy.results.fixFirst": [[1], [3]],
  "copy.results.distance": [
    [{ kind: "against" }],
    [{ kind: "within", high: 1 }],
    [{ kind: "within", high: 5 }],
    [{ kind: "about", feet: 1 }],
    [{ kind: "about", feet: 12 }],
    [{ kind: "range", low: 5, high: 30 }],
  ],
  "copy.results.inside": [[0], [1], [3]],
  "copy.results.close": [[1], [3]],
  "copy.results.out": [[0], [1], [3]],
  "copy.results.notChecked": LOOP_CONCEPTS.map((concept) => [concept]),
  "copy.results.unplaced": [...SIDES, null].flatMap((side) => [...LOOP_CONCEPTS.map((concept) => [side, [concept]]), [side, LOOP_CONCEPTS.slice(0, 3)]]),
  "copy.results.walked": [[DAY]],
  "copy.finding.secondCheck": words,
  "copy.finding.sides": [[["left"]], [["left", "back"]], [[...SIDES]]],
  "copy.record.oneSide": sides,
  "copy.record.timeLeft": [[65_000], [600_000]],
  "copy.send.sending": [[512, 1024], [0, 0]],
  "copy.send.step": STATES.map((state) => [state]),
  "copy.send.counted": [[2, 7]],
  "copy.send.savedMinutes": [[1], [4]],
};

type Line = { path: string; text: string };

const lines = (value: unknown, path: string, args = ARGS): Line[] => {
  if (typeof value === "string") return [{ path, text: value }];
  if (typeof value === "function") {
    const samples = args[path];
    if (samples === undefined) throw new Error(`no sample arguments for ${path}`);
    return samples.map((sample, n) => ({ path: `${path}#${n}`, text: (value as (...a: unknown[]) => string)(...sample) }));
  }
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => lines(child, `${path}.${key}`, args));
  throw new Error(`${path} is neither text, a function nor an object`);
};

const missing = (english: Line[], spanish: Line[]): string[] => {
  const paths = new Set(spanish.map((line) => line.path));
  return english.filter((line) => !paths.has(line.path)).map((line) => line.path);
};

const ENGLISH = [...lines(draft, "draft"), ...lines(unbacked, "unbacked"), ...lines(copy, "copy")];
const SPANISH = [...lines(draftEs, "draft"), ...lines(unbackedEs, "unbacked"), ...lines(copyEs, "copy")];
const SPANISH_AT = new Map(SPANISH.map((line) => [line.path, line.text]));

const WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
};

const figures = (text: string): string[] =>
  [...text.toLowerCase().matchAll(/\d+|\p{L}+/gu)].map((m) => (/^\d/.test(m[0]) ? m[0] : WORDS[m[0]])).filter((n) => n !== undefined).sort();

const figureChanges = (english: Line[], spanishAt: Map<string, string>): string[] =>
  english.filter((line) => figures(line.text).join(" ") !== figures(spanishAt.get(line.path) ?? "").join(" ")).map((line) => line.path);

describe("the Spanish copy", () => {
  it("has a Spanish line for every English line, and no Spanish line without English", () => {
    expect(missing(ENGLISH, SPANISH)).toEqual([]);
    expect(missing(SPANISH, ENGLISH)).toEqual([]);
  });

  it("reports a planted English line that has no Spanish", () => {
    const planted = lines({ ...copy, home: { ...copy.home, planted: "A new English line." } }, "copy");
    expect(missing(planted, lines(copyEs, "copy"))).toEqual(["copy.home.planted"]);
  });

  it("refuses a function line nobody gave sample arguments for", () => {
    expect(() => lines({ walk: (n: number) => `${n}` }, "copy", {})).toThrow("no sample arguments for copy.walk");
  });

  it("translates every line, keeping only the brand name as it is", () => {
    const same = ENGLISH.filter((line) => line.text === SPANISH_AT.get(line.path) && !SAME_IN_BOTH.has(line.text));
    expect(same.map((line) => line.path)).toEqual([]);
    for (const line of SPANISH) {
      expect(line.text.trim(), line.path).not.toBe("");
      expect(line.text, line.path).not.toMatch(/undefined|NaN|\$\{/);
    }
  });

  it("keeps every number, distance and limit of the English line", () => {
    expect(figureChanges(ENGLISH, SPANISH_AT)).toEqual([]);
    const planted = [
      { path: "digit", text: "Within 5 feet of the house." },
      { path: "word", text: "Up to ten minutes." },
      { path: "kept", text: "Within 30 feet." },
    ];
    const plantedEs = new Map([["digit", "A 6 pies o menos de la casa."], ["word", "Hasta nueve minutos."], ["kept", "A 30 pies o menos."]]);
    expect(figureChanges(planted, plantedEs)).toEqual(["digit", "word"]);
    expect(figures("Within 5 feet, about three big steps")).toEqual(["3", "5"]);
    expect(figures("A 5 pies o menos, a unos tres pasos")).toEqual(["3", "5"]);
  });

  it("gives one English line one Spanish line everywhere it appears", () => {
    const byEnglish = new Map<string, Set<string>>();
    for (const line of ENGLISH) byEnglish.set(line.text, (byEnglish.get(line.text) ?? new Set()).add(SPANISH_AT.get(line.path)!));
    expect([...byEnglish].filter(([, spanish]) => spanish.size > 1).map(([english]) => english)).toEqual([]);
  });

  it("names the four sides and the four corners in Spanish, side by side with the English", () => {
    expect(Object.keys(sidesEs).sort()).toEqual([...SIDES].sort());
    expect(copyEs.results.walkSide("back")).toBe("Recorrer el lado trasero");
    expect(copyEs.results.walkSide("front")).toBe("Recorrer el lado frontal");
    expect(draftEs.corners.panCorner("back_left")).toBe("Panorámica de la esquina trasera izquierda");
  });

  it("writes both dates in Spanish with the same day, month and year", () => {
    expect(longDate(DAY)).toBe("Wednesday, October 28th, 2026");
    expect(longDateEs(DAY)).toBe("miércoles, 28 de octubre de 2026");
    const ms = Date.UTC(2026, 10, 4, 20, 5);
    expect(walkDate(ms)).toMatch(/Nov/);
    expect(walkDateEs(ms)).toMatch(/nov/);
    expect(figures(walkDateEs(ms))).toEqual(figures(walkDate(ms)));
  });
});

const shippedApp = async (): Promise<{ modules: string[]; shipped: string }> => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = await build({ root, logLevel: "silent", build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
  const modules = outputs.flatMap((chunk) => ("moduleIds" in chunk ? chunk.moduleIds : []));
  return { modules, shipped: outputs.map((chunk) => ("code" in chunk ? chunk.code : "")).join("\n") };
};

describe("Spanish in the app that ships", () => {
  it("is built in beside the English, so it works with no signal", async () => {
    const { modules, shipped } = await shippedApp();
    expect(modules.filter((id) => id.endsWith("/src/copy-es.ts"))).toHaveLength(1);
    expect(shipped).toContain(copy.home.walk);
    expect(shipped).toContain(copyEs.home.walk);
  }, 120_000);
});
