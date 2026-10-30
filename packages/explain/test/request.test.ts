import { describe, expect, it } from "vitest";
import { MetaRefused, REASONING_ROOM, SPARK_MODEL } from "@emberwalk/meta";
import { evaluate, rank, type Observation } from "@emberwalk/rules";
import { explainRequest, MAX_FRAME_CHARACTERS, MAX_FRAMES, MAX_OUTPUT_TOKENS, ruleTable, type ExplainFinding, type ExplainInput } from "../src/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const observation = (n: number, concept: Observation["concept"], low: number): Observation => ({
  id: id(n),
  concept,
  distanceFeet: { low, high: low + 2 },
  contact: "no",
  plantState: null,
  spacing: null,
  flags: [],
  frameShare: 0.2,
  confidence: 0.9,
});

const findings = (obs: Observation[]): ExplainFinding[] =>
  rank(evaluate(obs, "ca")).map((f, i) => ({ ...f, findingId: id(100 + i), observation: obs.find((o) => o.id === f.observationId)! }));

const input = (o: Partial<ExplainInput> = {}): ExplainInput => ({
  walkId: id(1),
  jurisdiction: "ca",
  language: "en",
  content: "synthetic",
  findings: findings([observation(1, "wood_pile", 1), observation(2, "dry_brush", 10)]),
  turns: [{ t: 3.5, text: "That pile is firewood for winter." }],
  frames: ["https://frames.example/a.jpg", "https://frames.example/b.jpg"],
  ...o,
});

type Body = { [key: string]: unknown; input: { content: { type: string; text?: string; image_url?: string }[] }[] };
const body = (i: ExplainInput) => explainRequest(i).request.json as Body;

const completed = (text: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1, output_tokens: 1 } });

describe("explainRequest, normal", () => {
  it("puts the jurisdiction's rule table first, byte for byte the same for two walks", () => {
    const a = JSON.stringify(body(input()));
    const other = input({ walkId: id(2), language: "es", findings: findings([observation(3, "shed", 20)]), turns: [], frames: [] });
    const b = JSON.stringify(body(other));
    const table = JSON.stringify(ruleTable("ca")).slice(1, -1);
    const end = a.indexOf(table) + table.length;
    expect(a.indexOf(table)).toBeGreaterThan(0);
    expect(b.slice(0, end)).toBe(a.slice(0, end));
    expect(a).not.toBe(b);
    expect(body(input()).input[0]!.content).toEqual([{ type: "input_text", text: ruleTable("ca") }]);
  });

  it("gives each jurisdiction its own table, holding only its statutes' rules", () => {
    expect(ruleTable("ca_sra")).not.toBe(ruleTable("ca_vhfhsz"));
    expect(ruleTable("ca").length).toBeGreaterThan(ruleTable("ca_sra").length);
    expect(ruleTable("ca").length).toBeGreaterThan(ruleTable("ca_vhfhsz").length);
    expect(ruleTable("ca_sra").startsWith("RULE TABLE ca_sra\n[")).toBe(true);
  });

  it("asks for low reasoning, JSON by schema, a capped answer and nothing stored", () => {
    const call = explainRequest(input());
    const json = call.request.json as Body;
    expect(json).toMatchObject({
      model: SPARK_MODEL,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS + REASONING_ROOM.low,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "emberwalk_explain", strict: false } },
    });
    expect((json["text"] as { format: { schema: { type: string } } }).format.schema.type).toBe("object");
    expect(call).toMatchObject({ step: "explain", walkId: id(1), content: "synthetic", request: { method: "POST", path: "/responses" } });
    expect(call.estimateNano).toBeGreaterThan(0);
  });

  it("sends the findings, turns, language and content kind, then the frames as images in order", () => {
    const [, walk] = body(input()).input;
    const sent = JSON.parse(walk!.content[0]!.text!);
    expect(sent.language).toBe("en");
    expect(sent.content).toBe("synthetic");
    expect(sent.turns).toEqual([{ t: 3.5, text: "That pile is firewood for winter." }]);
    expect(sent.findings.map((f: { findingId: string }) => f.findingId)).toEqual([id(100), id(101)]);
    expect(sent.findings[0]).toEqual(expect.objectContaining({ rank: 1, concept: "wood_pile", band: "zone_0" }));
    expect(sent.problems).toBeUndefined();
    expect(walk!.content.slice(1)).toEqual([
      { type: "input_image", image_url: "https://frames.example/a.jpg" },
      { type: "input_image", image_url: "https://frames.example/b.jpg" },
    ]);
    const retry = JSON.parse(body(input({ problems: ["finding 1: unknown rule id"] })).input[1]!.content[0]!.text!);
    expect(retry.problems).toEqual(["finding 1: unknown rule id"]);
  });

  it("sends a frame given as a JPEG data link as an image, in order with the web links", () => {
    const still = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]).toString("base64")}`;
    const [, walk] = body(input({ frames: [still, "https://frames.example/b.jpg"] })).input;
    expect(walk!.content.slice(1)).toEqual([
      { type: "input_image", image_url: still },
      { type: "input_image", image_url: "https://frames.example/b.jpg" },
    ]);
  });

  it("estimates more input for every frame", () => {
    expect(explainRequest(input()).estimateNano).toBeGreaterThan(explainRequest(input({ frames: [] })).estimateNano);
  });
});

describe("explainRequest, invalid", () => {
  it("refuses a walk with no findings", () => {
    expect(() => explainRequest(input({ findings: [] }))).toThrow(/no findings/);
  });

  it(`refuses more than ${MAX_FRAMES} frames, and keeps ${MAX_FRAMES}`, () => {
    const frames = (n: number) => Array.from({ length: n }, (_, i) => `https://frames.example/${i}.jpg`);
    expect(() => explainRequest(input({ frames: frames(MAX_FRAMES + 1) }))).toThrow(/at most 10 proof frames/);
    expect(body(input({ frames: frames(MAX_FRAMES) })).input[1]!.content).toHaveLength(MAX_FRAMES + 1);
    expect(() => explainRequest(input({ frames: ["http://frames.example/a.jpg"] }))).toThrow();
  });

  it.each([
    ["a PNG data link", "data:image/png;base64,AAAA"],
    ["a data link that is not base64", "data:image/jpeg;base64,not base64!"],
    ["a data link with no bytes", "data:image/jpeg;base64,"],
    ["a script link", "javascript:alert(1)"],
    ["a data link over the size cap", `data:image/jpeg;base64,${"A".repeat(MAX_FRAME_CHARACTERS)}`],
  ])("refuses %s as a frame", (_name, frame) => {
    expect(() => explainRequest(input({ frames: [frame] }))).toThrow();
  });

  it("refuses a finding id given twice", () => {
    const [first] = input().findings;
    expect(() => explainRequest(input({ findings: [first!, { ...first!, rank: 2 }] }))).toThrow(/its own findingId/);
  });

  it("refuses a proof frame that is not a frame link", () => {
    const [first] = input().findings;
    expect(() => explainRequest(input({ findings: [{ ...first!, proofFrame: "file:///etc/passwd" }] }))).toThrow();
  });

  it("refuses a language other than en and es", () => {
    expect(() => explainRequest(input({ language: "fr" as "en" }))).toThrow();
  });
});

describe("explainRequest, refused answers", () => {
  const answer = {
    findings: [
      {
        findingId: id(100),
        verdict: "keep",
        reason: "The pile sits against the wall.",
        plantState: null,
        spacing: null,
        bandCheck: "same",
        instruction: "Move the wood pile at least 5 feet from the house.",
        ruleIds: ["ca-zone0-wood-pile"],
        language: "en",
      },
    ],
  };

  it("reads an answer that fits the schema", () => {
    expect(explainRequest(input()).read(completed(JSON.stringify(answer)))).toEqual(answer);
  });

  it("reads an answer failing the schema, or not JSON, as invalid_answer", () => {
    const call = explainRequest(input());
    for (const bad of [
      JSON.stringify({ findings: [{ ...answer.findings[0], bandCheck: "nearer" }] }),
      JSON.stringify({ findings: [{ ...answer.findings[0], extra: 1 }] }),
      JSON.stringify({ findings: [{ ...answer.findings[0], language: "fr" }] }),
      "not json",
    ]) {
      let caught: unknown;
      try {
        call.read(completed(bad));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MetaRefused);
      expect((caught as MetaRefused).reason).toBe("invalid_answer");
    }
  });
});
