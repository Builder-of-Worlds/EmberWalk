import { describe, expect, it } from "vitest";
import { MetaHttpError } from "@emberwalk/meta";
import { RULES } from "@emberwalk/rules";
import { explain, MAX_INSTRUCTION_WORDS, type ExplainAnswer, type FindingAnswer } from "../src/index.ts";
import keepFixture from "./fixtures/stand-in-keep.json" with { type: "json" };
import wrongFixture from "./fixtures/stand-in-wrong.json" with { type: "json" };
import { findings, id, input, observation, standIn } from "./support.ts";

const answerOf = ({ standIn: _, ...answer }: { standIn: string; findings: unknown[] }) => structuredClone(answer) as ExplainAnswer;
const KEEP = answerOf(keepFixture);
const WOOD = id(100);
const FENCE = id(101);
const BRUSH = id(102);

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
    const fence = byId((await explain(client, input())).results, FENCE);
    expect(fence).toMatchObject({ verdict: "veto", reason: "The frames show a metal fence, not a wooden one.", bandCheck: "closer", band: "zone_0" });
  });

  it("drops the dead fuel rule from a brush the model judges alive (D-103), as a veto by the rules", async () => {
    const { client } = standIn([withAnswer(BRUSH, { plantState: "alive", reason: "The brush is green." })]);
    const brush = byId((await explain(client, input())).results, BRUSH);
    expect(brush).toMatchObject({ verdict: "veto", vetoBy: "rules", reason: "The brush is green.", plantState: "alive", wording: "model" });
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
    const long = `Remove the dead brush within 30 feet of the house ${"and then rake every last leaf ".repeat(5)}today.`;
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
    expect(byId(out.results, BRUSH)).toMatchObject({ wording: "template", instruction: "Remove dry brush within 30 feet of the house." });
    expect(out.results).toHaveLength(3);
  });

  it("refuses a finding answered twice", async () => {
    const { out } = await twice({ findings: [...KEEP.findings, KEEP.findings[0]!] });
    expect(byId(out.results, WOOD)).toMatchObject({ wording: "template", problems: [expect.stringContaining("answered twice")] });
  });

  it("takes a good retry for the findings that failed and keeps the first answer for the rest", async () => {
    const wrong = answerOf(wrongFixture);
    const { client, requests } = standIn([wrong, KEEP]);
    const out = await explain(client, input());
    expect(requests).toHaveLength(2);
    expect(sentProblems(requests[1]!)).toEqual([
      `finding ${WOOD}: unknown rule id ca-wood-pile-nowhere-z0`,
      `finding ${FENCE}: a wooden_fence has no plant state`,
      `finding ${BRUSH}: no answer`,
      `finding ${id(999)}: not asked`,
    ]);
    expect(out.results.map((r) => r.wording)).toEqual(["model", "model", "model"]);
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
