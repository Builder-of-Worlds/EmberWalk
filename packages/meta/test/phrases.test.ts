import { describe, expect, it } from "vitest";
import { MetaRefused } from "../src/errors.ts";
import { type PhraseConcept, SAM_PHRASES, samPhrase } from "../src/phrases.ts";
import { SamConcept } from "../src/sam.ts";
import type { HttpRequest } from "../src/transport.ts";
import { conceptOf, isFound, ProbeStopLine, runProbe, scoreRecorded } from "./live/probe.ts";
import { type Hazard, motion, type Rect, truth, truthRect, windowFrames } from "./live/env.ts";
import { NOW, ok, setup } from "./support.ts";

const FPS = 2;
const m = motion();
const hazards = truth().hazards;
const hazard = (id: string): Hazard => hazards.find((h) => h.id === id)!;
const { width_px: W, height_px: H } = m.camera;

const record = (id: number, r: Rect) => {
  const x1 = Math.round(r.left);
  const y1 = Math.round(r.top);
  const x2 = Math.min(W - 1, Math.max(x1, Math.round(r.right) - 1));
  const y2 = Math.min(H - 1, Math.max(y1, Math.round(r.bottom) - 1));
  return `${id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${W};h=${H}|><|mask;x=0;y=0;data=1,1,~!|>`;
};
const line = (frame: number, rects: Rect[]) => `<${frame}f>${rects.map((r, i) => record(i, r)).join(",")}`;
const body = (text: string, status = "completed") => ({
  status,
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { video_frames_processed: 50 },
});

const onHazard = (h: Hazard) => windowFrames(h.visible_s, FPS).map((f) => line(f, [truthRect(h, m, f / FPS)!])).join("\n");
const WALL: Rect = { left: 200, top: 0, right: 1920, bottom: 640 };
type SamJson = { input: { content: { text: string }[] }[] };
const phraseOf = (req: HttpRequest): string => {
  if (!("json" in req)) throw new Error("expected a request with a body");
  return (req.json as unknown as SamJson).input[0]!.content[0]!.text;
};

describe("scoring a recorded answer", () => {
  it("counts a hazard found when boxes land on it on at least half of its window", () => {
    const brush = hazard("dry-brush-1");
    const score = scoreRecorded(brush, body(onHazard(brush)), m, FPS);
    expect(score).toMatchObject({ hits: score.window, elsewhere: 0, found: true });
    expect(score.window).toBeGreaterThan(0);
  });

  it("does not count a box on the house wall as the fence", () => {
    const fence = hazard("fence-joint-1");
    const text = windowFrames(fence.visible_s, FPS).map((f) => line(f, [WALL])).join("\n");
    const score = scoreRecorded(fence, body(text), m, FPS);
    expect(score).toMatchObject({ hits: 0, elsewhere: score.window, found: false });
  });

  it("scores an answer with no objects as not found", () => {
    expect(scoreRecorded(hazard("dry-brush-1"), body(""), m, FPS)).toMatchObject({ hits: 0, elsewhere: 0, found: false });
  });

  it("needs half the window, rounded up", () => {
    expect(isFound(4, 8)).toBe(true);
    expect(isFound(3, 8)).toBe(false);
    expect(isFound(3, 5)).toBe(true);
    expect(isFound(2, 5)).toBe(false);
    expect(isFound(0, 0)).toBe(false);
  });

  it.each([
    ["a record without a mask", body("<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>")],
    ["a box past its frame", body("<0f>0<|box;x1=1;y1=1;x2=9;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,~!|>")],
    ["an answer that did not complete", body("", "incomplete")],
    ["an answer with no output list", { status: "completed" }],
  ])("rejects %s", (_name, raw) => {
    expect(() => scoreRecorded(hazard("dry-brush-1"), raw, m, FPS)).toThrow(MetaRefused);
  });
});

describe("the phrase probe", () => {
  const options = (s: ReturnType<typeof setup>, stopLineUsd: number) => ({
    client: s.client,
    ledger: s.ledger,
    video: { fileId: "file-1" },
    frames: 40,
    fps: FPS,
    stopLineUsd,
    hazards,
    motion: m,
    now: () => NOW,
  });
  const answerBy = (hits: Record<string, string>) => (req: HttpRequest) => ok(body(hits[phraseOf(req)] ?? ""));

  it("sends one call per candidate phrase and scores each", async () => {
    const brush = hazard("dry-brush-1");
    const s = setup({ answer: answerBy({ "dead branches": onHazard(brush) }) });
    const rows = await runProbe(options(s, 1));
    const asked = SAM_PHRASES.dry_brush.candidates.concat(SAM_PHRASES.wooden_fence.candidates);
    expect(s.transport.requests.map(phraseOf)).toEqual(asked);
    expect(rows.map((r) => r.phrase)).toEqual(asked);
    expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(asked.length);
    expect(rows.filter((r) => r.found)).toMatchObject([{ hazard: "dry-brush-1", phrase: "dead branches", costUsd: 0.01, cached: false }]);
    expect(await s.ledger.spentUsd("2026-10-26")).toBeCloseTo(0.08, 12);
  });

  it("makes every call when the stop line equals the total", async () => {
    const s = setup({ answer: answerBy({}) });
    expect(await runProbe(options(s, 0.08))).toHaveLength(8);
  });

  it("refuses the call that would pass the stop line and sends nothing more", async () => {
    const s = setup({ answer: answerBy({}) });
    const err = await runProbe(options(s, 0.015)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProbeStopLine);
    expect(s.transport.requests).toHaveLength(1);
  });

  it("starts no call when one call is already over the stop line", async () => {
    const s = setup({ answer: answerBy({}) });
    expect(await runProbe(options(s, 0.005)).catch((e: unknown) => e)).toBeInstanceOf(ProbeStopLine);
    expect(s.transport.requests).toHaveLength(0);
  });

  it("stops on spend already in the ledger", async () => {
    const s = setup({ answer: answerBy({}) });
    await runProbe(options(s, 0.08));
    const again = await runProbe({ ...options(s, 0.085), hazards: [hazard("dry-brush-1")] }).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(ProbeStopLine);
  });

  it("skips hazards that have no phrase row", () => {
    expect(conceptOf({ ...hazard("dry-brush-1"), concept: "roof debris" })).toBeNull();
    expect(conceptOf(hazard("fence-joint-1"))).toBe("wooden_fence");
  });
});

describe("the phrase table", () => {
  const concepts = Object.keys(SAM_PHRASES) as PhraseConcept[];

  it("holds only phrases SAM accepts", () => {
    for (const c of concepts) {
      const row = SAM_PHRASES[c];
      for (const phrase of [row.baseline, ...row.candidates]) expect(() => SamConcept.parse(phrase), phrase).not.toThrow();
    }
  });

  it("names a row for every hazard in the synthetic truth", () => {
    for (const h of hazards) expect(conceptOf(h), h.id).not.toBeNull();
  });

  it("allows a winner only from its own phrases", () => {
    for (const c of concepts) {
      const row = SAM_PHRASES[c];
      if (row.winner !== null) expect([row.baseline, ...row.candidates], c).toContain(row.winner);
    }
  });

  it("gives the winner, else the baseline", () => {
    expect(samPhrase("wood_pile")).toBe("wood pile");
    expect(samPhrase("dry_brush")).toBe(SAM_PHRASES.dry_brush.winner ?? "dry brush");
  });
});
