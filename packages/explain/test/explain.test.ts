import { describe, expect, it } from "vitest";
import { MetaHttpError } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { explain, MAX_INSTRUCTION_WORDS, type ExplainAnswer, type FindingAnswer } from "../src/index.ts";
import keepFixture from "./fixtures/stand-in-keep.json" with { type: "json" };
import wrongFixture from "./fixtures/stand-in-wrong.json" with { type: "json" };
import { findings, id, input, observation, standIn, withProofFrame } from "./support.ts";

const answerOf = ({ standIn: _, ...answer }: { standIn: string; findings: unknown[] }) => structuredClone(answer) as ExplainAnswer;
const KEEP = answerOf(keepFixture);
const WOOD = id(100);
const FENCE = id(101);
const BRUSH = id(102);
const SENT = "https://frames.example/a.jpg";

const withAnswer = (findingId: string, change: Partial<FindingAnswer>): ExplainAnswer => ({
  findings: KEEP.findings.map((f) => (f.findingId === findingId ? { ...f, ...change } : f)),
});
const without = (findingId: string): ExplainAnswer => ({ findings: KEEP.findings.filter((f) => f.findingId !== findingId) });
const byId = <T extends { findingId: string }>(results: T[], findingId: string) => results.find((r) => r.findingId === findingId)!;
const sentProblems = (request: unknown): string[] | undefined => {
  const walk = ((request as { json: unknown }).json as { input: { content: { text?: string }[] }[] }).input[1]!.content[0]!.text!;
  return JSON.parse(walk).problems;
};

describe("explain, normal", () => {
  it("gives every finding the model's wording when the answer checks out, in one request", async () => {
    const { client, requests } = standIn([KEEP]);
    const out = await explain(client, input());
    expect(requests).toHaveLength(1);
    expect(out.refused).toBeNull();
    expect(out.results.map((r) => [r.findingId, r.wording])).toEqual([
      [WOOD, "model"],
      [FENCE, "model"],
      [BRUSH, "model"],
    ]);
    expect(byId(out.results, WOOD)).toMatchObject({
      verdict: "keep",
      instruction: "Move the wood pile more than 30 feet from the house, or cover it completely.",
      ruleIds: ["ca-wood-pile-uncovered-ccr-z0", "ca-wood-pile-zone-0-calfire-z0"],
      bandCheck: "same",
      problems: [],
    });
    expect(byId(out.results, BRUSH)).toMatchObject({ plantState: "dead", label: "required_now" });
  });

  it("keeps a vetoed finding with its reason, and records the band check without moving the band", async () => {
    const { client } = standIn([KEEP]);
    const shown = withProofFrame(input().findings, FENCE, SENT);
    const fence = byId((await explain(client, input({ findings: shown }))).results, FENCE);
    expect(fence).toMatchObject({ verdict: "veto", vetoBy: "model", reason: "The frames show a metal fence, not a wooden one.", bandCheck: "closer", band: "zone_0" });
  });

  it("keeps a finding the model vetoes when the frame that shows it was not among the frames sent", async () => {
    const { client } = standIn([KEEP]);
    const shown = withProofFrame(input().findings, FENCE, "https://frames.example/not-sent.jpg");
    const out = await explain(client, input({ findings: shown }));
    expect(byId(out.results, FENCE)).toMatchObject({ verdict: "keep", vetoBy: null, reason: null, wording: "model" });
  });

  it("keeps a vetoed finding that has no proof frame at all", async () => {
    const { client } = standIn([KEEP]);
    const out = await explain(client, input());
    expect(byId(out.results, FENCE)).toMatchObject({ verdict: "keep", vetoBy: null, reason: null });
  });

  it("does not take a veto the model gives when it was shown no frames, so words alone never remove a finding", async () => {
    const { client } = standIn([KEEP]);
    const out = await explain(client, input({ frames: [] }));
    expect(byId(out.results, FENCE)).toMatchObject({ verdict: "keep", vetoBy: null, reason: null, wording: "model" });
    expect(out.results.filter((r) => r.verdict === "veto")).toEqual([]);
  });

  it("drops the dead fuel rule from a brush the model judges alive, as a veto by the rules", async () => {
    const { client } = standIn([withAnswer(BRUSH, { plantState: "alive", reason: "The brush is green." })]);
    const brush = byId((await explain(client, input())).results, BRUSH);
    expect(brush).toMatchObject({ verdict: "veto", vetoBy: "rules", reason: "The brush is green.", plantState: "alive", wording: "template" });
  });

  it("reruns the rules with the model's spacing, so a tree judged too close gets the spacing rule", async () => {
    const tree = findings([observation(4, "tree", 15, { plantState: "unsure" })]);
    const answer = {
      findings: [
        {
          findingId: id(100),
          verdict: "keep",
          reason: "Two trees touch.",
          plantState: "alive",
          spacing: "too_close",
          bandCheck: "same",
          instruction: "Keep a 10 foot gap between these trees.",
          ruleIds: ["ca-tree-spacing-calfire-z1"],
          language: "en",
        },
      ],
    };
    const { client } = standIn([answer]);
    const out = await explain(client, input({ findings: tree }));
    expect(out.results[0]).toMatchObject({ wording: "model", spacing: "too_close", ruleIds: ["ca-tree-spacing-calfire-z1"], verdict: "keep" });
  });

  it(`trims an instruction over ${MAX_INSTRUCTION_WORDS} words and keeps it as the model's`, async () => {
    const long = `Remove the dead brush within 30 feet of the house ${"and then rake every last leaf ".repeat(5)}too.`;
    expect(long.split(" ").length).toBeGreaterThan(35);
    const { client, requests } = standIn([withAnswer(BRUSH, { instruction: long })]);
    const brush = byId((await explain(client, input())).results, BRUSH);
    expect(requests).toHaveLength(1);
    expect(brush.wording).toBe("model");
    expect(brush.instruction.split(" ")).toHaveLength(MAX_INSTRUCTION_WORDS);
    expect(long.startsWith(brush.instruction)).toBe(true);
  });

  it("writes one ledger line per priced unit of every request, all for the explain step of the walk", async () => {
    const { client, ledger } = standIn([KEEP]);
    const out = await explain(client, input());
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries.every((e) => e.step === "explain" && e.walkId === id(1) && !e.cached)).toBe(true);
    expect(out.costUsd).toBeGreaterThan(0);
  });
});

describe("explain, invalid answers", () => {
  const twice = async (answer: unknown) => {
    const run = standIn([answer]);
    return { ...run, out: await explain(run.client, input()) };
  };

  it("gives template wording to a finding with an unknown rule id, after one retry naming the problem", async () => {
    const { out, requests } = await twice(withAnswer(WOOD, { ruleIds: ["ca-wood-pile-nowhere-z0"] }));
    expect(requests).toHaveLength(2);
    expect(sentProblems(requests[0]!)).toBeUndefined();
    expect(sentProblems(requests[1]!)).toEqual([`finding ${WOOD}: unknown rule id ca-wood-pile-nowhere-z0`]);
    const wood = byId(out.results, WOOD);
    expect(wood.wording).toBe("template");
    expect(wood.instruction).toBe(input().findings[0]!.instruction);
    expect(byId(out.results, BRUSH).wording).toBe("model");
  });

  it("refuses a rule from another band, or of another concept", async () => {
    const zone1 = await twice(withAnswer(WOOD, { ruleIds: ["ca-wood-pile-uncovered-ccr-z1"] }));
    expect(byId(zone1.out.results, WOOD)).toMatchObject({ wording: "template", problems: [expect.stringContaining("does not fit wood_pile in zone_0")] });
    const brush = await twice(withAnswer(WOOD, { ruleIds: ["ca-dry-brush-ccr-z0"] }));
    expect(byId(brush.out.results, WOOD).wording).toBe("template");
  });

  it("refuses a plant state on a fence and a spacing on a wood pile", async () => {
    const plant = await twice(withAnswer(FENCE, { plantState: "dead" }));
    expect(byId(plant.out.results, FENCE)).toMatchObject({ wording: "template", plantState: null, verdict: "keep" });
    const spaced = await twice(withAnswer(WOOD, { spacing: "too_close" }));
    expect(byId(spaced.out.results, WOOD)).toMatchObject({ wording: "template", spacing: null });
  });

  it("refuses an instruction naming feet other than its rule's distances, in either language", async () => {
    const wrong = await twice(withAnswer(BRUSH, { instruction: "Remove the dead brush within 50 feet of the house." }));
    expect(byId(wrong.out.results, BRUSH)).toMatchObject({ wording: "template", problems: [expect.stringContaining("50 feet")] });
    const fine = await twice(withAnswer(FENCE, { instruction: "Replace the wooden fence near the house; keep 5 ft clear." }));
    expect(byId(fine.out.results, FENCE).wording).toBe("model");
    const es = KEEP.findings.map((f) => ({ ...f, language: "es" as const, instruction: "Quite la maleza seca a menos de 30 pies de la casa." }));
    const spanish = standIn([{ findings: es.map((f) => (f.findingId === WOOD ? { ...f, instruction: "Mueva la leña a 12 pies." } : f)) }]);
    const out = await explain(spanish.client, input({ language: "es" }));
    expect(byId(out.results, WOOD)).toMatchObject({ wording: "template", instruction: RULES.find((r) => r.id === "ca-wood-pile-uncovered-ccr-z0")!.plain.es });
    expect(byId(out.results, BRUSH).wording).toBe("model");
  });

  it("refuses an answer in another language than the walk's", async () => {
    const { out } = await twice(withAnswer(WOOD, { language: "es" }));
    expect(byId(out.results, WOOD).wording).toBe("template");
  });

  it("gives a missing finding template wording, and ignores an answer for a finding not asked", async () => {
    const { out, requests } = await twice({ findings: [...without(BRUSH).findings, { ...KEEP.findings[2]!, findingId: id(999) }] });
    expect(requests).toHaveLength(2);
    expect(sentProblems(requests[1]!)).toEqual([`finding ${BRUSH}: no answer`, `finding ${id(999)}: not asked`]);
    expect(byId(out.results, BRUSH)).toMatchObject({
      wording: "template",
      instruction: "Cut the dry brush and haul it off, or bag it for the green waste bin.",
    });
    expect(out.results).toHaveLength(3);
  });

  it("refuses a finding answered twice", async () => {
    const { out } = await twice({ findings: [...KEEP.findings, KEEP.findings[0]!] });
    expect(byId(out.results, WOOD)).toMatchObject({ wording: "template", problems: [expect.stringContaining("answered twice")] });
  });

  it("takes a good retry for the findings that failed and keeps the first answer for the rest", async () => {
    const wrong = answerOf(wrongFixture);
    const { client, requests } = standIn([wrong, KEEP]);
    const out = await explain(client, input({ findings: withProofFrame(input().findings, FENCE, SENT) }));
    expect(requests).toHaveLength(2);
    expect(sentProblems(requests[1]!)).toEqual([
      `finding ${WOOD}: unknown rule id ca-wood-pile-nowhere-z0`,
      `finding ${FENCE}: a wooden_fence has no plant state`,
      `finding ${BRUSH}: no answer`,
      `finding ${id(999)}: not asked`,
    ]);
    expect(out.results.map((r) => r.wording)).toEqual(["model", "template", "model"]);
    expect(byId(out.results, FENCE).verdict).toBe("veto");
  });

  it("retries an answer that is not JSON, then gives template wording", async () => {
    const { client, requests } = standIn(["not json", "still not json"]);
    const out = await explain(client, input());
    expect(requests).toHaveLength(2);
    expect(sentProblems(requests[1]!)).toEqual([expect.stringContaining("invalid_answer")]);
    expect(out.results.every((r) => r.wording === "template")).toBe(true);
    expect(out.refused).toBe("invalid_answer");
  });
});

describe("explain, helpful calm wording", () => {
  const plainOf = (ruleId: string, language: "en" | "es") => RULES.find((r) => r.id === ruleId)!.plain[language];
  const BRUSH_RULE = "ca-dry-brush-ccr-z1";
  const spanish = (instruction: string) => ({
    findings: KEEP.findings.map((f) => ({ ...f, language: "es" as const, instruction: f.findingId === BRUSH ? instruction : "Lleve la leña y la cerca a 30 pies." })),
  });

  it("keeps a calm sentence that gives a concrete way and the rule's distance, as the model's", async () => {
    const sentence = "Stack the firewood more than 30 feet from the house, or cover it with sheet metal.";
    const { client, requests } = standIn([withAnswer(WOOD, { instruction: sentence })]);
    const wood = byId((await explain(client, input())).results, WOOD);
    expect(requests).toHaveLength(1);
    expect(wood).toMatchObject({ wording: "model", instruction: sentence, problems: [] });
  });

  it.each(["woody", "combustible", "fuels", "aerial", "fire resistant", "fire-resistant", "right away", "now", "immediately", "urgent", "soon", "at all times", "before it is too late"])(
    "refuses an English sentence with %s and falls back to the rule's plain text",
    async (word) => {
      const { client, requests } = standIn([withAnswer(BRUSH, { instruction: `Remove the ${word} brush within 30 feet of the house.` })]);
      const brush = byId((await explain(client, input())).results, BRUSH);
      expect(requests).toHaveLength(2);
      expect(sentProblems(requests[1]!)).toEqual([expect.stringContaining(`"${word.replace("-", " ")}"`)]);
      expect(brush).toMatchObject({ wording: "template", instruction: plainOf(BRUSH_RULE, "en") });
    },
  );

  it.each(["leñosa", "combustible", "aérea", "resistente al fuego", "de inmediato", "ahora", "urgente", "pronto", "en todo momento", "antes de que sea tarde"])(
    "refuses a Spanish sentence with %s and falls back to the rule's plain text",
    async (word) => {
      const { client } = standIn([spanish(`Quite la maleza ${word} a menos de 30 pies de la casa.`)]);
      const brush = byId((await explain(client, input({ language: "es" }))).results, BRUSH);
      expect(brush).toMatchObject({ wording: "template", instruction: plainOf(BRUSH_RULE, "es"), problems: [expect.stringContaining(`"${word}"`)] });
    },
  );

  it("refuses a sentence that drops its rule's distance, in either language", async () => {
    const { client } = standIn([withAnswer(WOOD, { instruction: "Stack the firewood away from the wall, under sheet metal." })]);
    const wood = byId((await explain(client, input())).results, WOOD);
    expect(wood).toMatchObject({ wording: "template", problems: [expect.stringContaining("keep its rule's distance of 30 feet")] });
    const es = standIn([{ findings: KEEP.findings.map((f) => ({ ...f, language: "es" as const, instruction: "Apile la leña lejos de la pared." })) }]);
    expect(byId((await explain(es.client, input({ language: "es" }))).results, WOOD).wording).toBe("template");
  });

  it("keeps a sentence with no feet for a finding whose rule names no distance", async () => {
    const roof = findings([observation(5, "roof_debris", 10)]);
    const sentence = "Sweep the needles off the roof with a push broom, and scoop out the gutters by hand.";
    const answer = { findings: [{ ...KEEP.findings[0]!, findingId: id(100), instruction: sentence, ruleIds: roof[0]!.ruleIds }] };
    const { client } = standIn([answer]);
    const out = await explain(client, input({ findings: roof }));
    expect(out.results[0]).toMatchObject({ wording: "model", instruction: sentence, problems: [] });
  });

  it("refuses feet in a sentence for a finding whose rule names no distance, and says its rules name none", async () => {
    const roof = findings([observation(5, "roof_debris", 10)]);
    const sentence = "Sweep the needles off the roof and keep 50 feet clear.";
    const answer = { findings: [{ ...KEEP.findings[0]!, findingId: id(100), instruction: sentence, ruleIds: roof[0]!.ruleIds }] };
    const { client } = standIn([answer, answer]);
    const out = await explain(client, input({ findings: roof }));
    expect(out.results[0]).toMatchObject({ wording: "template", problems: ["names 50 feet, its rules name no feet"] });
  });

  it.each([
    ["en", "No fence was seen, so no fence work is needed."],
    ["en", "The frames do not show a fence, so nothing to do."],
    ["es", "No se vio ninguna cerca, así que no hace falta trabajo."],
  ] as const)("never lets a sentence about a thing not found reach the answer (%s: %s)", async (language, sentence) => {
    const answer = { findings: KEEP.findings.map((f) => ({ ...f, language, ...(f.findingId === FENCE ? { instruction: sentence } : {}) })) };
    const { client } = standIn([answer]);
    const out = await explain(client, input({ language }));
    const fence = byId(out.results, FENCE);
    expect(fence).toMatchObject({ verdict: "keep", wording: "template", reason: null, instruction: plainOf("ca-wooden-fence-zone-0-calfire-z0", language) });
    expect(fence.problems).toContainEqual(expect.stringContaining("not found"));
    expect(out.results.map((r) => r.instruction)).not.toContain(sentence);
  });

  it("gives a finding vetoed by its own frame the rule's sentence, never the model's", async () => {
    const answer = withAnswer(FENCE, { instruction: "No wooden fence here, nothing to do." });
    const { client, requests } = standIn([answer]);
    const fence = byId((await explain(client, input({ findings: withProofFrame(input().findings, FENCE, SENT) }))).results, FENCE);
    expect(requests).toHaveLength(1);
    expect(fence).toMatchObject({ verdict: "veto", vetoBy: "model", wording: "template", instruction: plainOf("ca-wooden-fence-zone-0-calfire-z0", "en"), problems: [] });
  });
});

describe("explain, refused", () => {
  it("sends nothing when the daily cap is reached, and gives every finding template wording", async () => {
    const { client, requests, ledger } = standIn([KEEP], { capUsd: 0.0001 });
    const out = await explain(client, input());
    expect(requests).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
    expect(out).toMatchObject({ refused: "daily_cap_reached", costUsd: 0 });
    expect(out.results.map((r) => r.wording)).toEqual(["template", "template", "template"]);
  });

  it("sends nothing for real content on free credits", async () => {
    const { client, requests } = standIn([KEEP]);
    const out = await explain(client, input({ content: "real" }));
    expect(requests).toHaveLength(0);
    expect(out.refused).toBe("real_content_on_free_credits");
    expect(out.results.every((r) => r.wording === "template")).toBe(true);
  });

  it("sends exactly two requests for a bad answer given twice, then template, with ledger lines for both", async () => {
    const wrong = answerOf(wrongFixture);
    const { client, requests, ledger } = standIn([wrong, wrong]);
    const out = await explain(client, input());
    expect(requests).toHaveLength(2);
    expect(ledger.entries).toHaveLength(4);
    expect(out.results.map((r) => r.wording)).toEqual(["template", "template", "template"]);
    expect(out.refused).toBeNull();
  });

  it("never throws on a transport failure", async () => {
    const { client, requests } = standIn([KEEP], { fail: new MetaHttpError(503, "busy", null) });
    const out = await explain(client, input());
    expect(requests).toHaveLength(1);
    expect(out.refused).toBe("transport");
    expect(out.results.every((r) => r.wording === "template")).toBe(true);
  });

  it("still refuses a bad walk before any request", async () => {
    const { client, requests } = standIn([KEEP]);
    await expect(explain(client, input({ findings: [] }))).rejects.toThrow(/no findings/);
    const [first] = input().findings;
    await expect(explain(client, input({ findings: [{ ...first!, observation: { ...first!.observation, id: id(55) } }] }))).rejects.toThrow(
      /the observation it came from/,
    );
    expect(requests).toHaveLength(0);
  });
});
