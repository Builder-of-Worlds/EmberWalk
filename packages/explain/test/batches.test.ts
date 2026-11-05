import { describe, expect, it } from "vitest";
import { batchesOf, explain, MAX_FINDINGS, MAX_FRAMES, type ExplainFinding } from "../src/index.ts";
import { findings, input, observation, standIn } from "./support.ts";

const many = (count: number, stills = count): ExplainFinding[] =>
  findings(Array.from({ length: count }, (_, i) => observation(i + 1, "wood_pile", 1))).map((f, i) => ({
    ...f,
    proofFrame: `https://frames.example/${i % stills}.jpg`,
  }));

type Sent = { json: { input: { content: { type: string; text?: string; image_url?: string }[] }[] } };
const sentIds = (request: unknown): string[] =>
  JSON.parse((request as Sent).json.input[1]!.content[0]!.text!).findings.map((f: { findingId: string }) => f.findingId);
const sentFrames = (request: unknown): string[] => (request as Sent).json.input[1]!.content.flatMap((c) => (c.image_url === undefined ? [] : [c.image_url]));
const empties = (n: number) => Array.from({ length: n }, () => ({ findings: [] }));

describe("batchesOf", () => {
  it("keeps a walk that fits together, with the frames it was given", () => {
    const list = many(3);
    expect(batchesOf(list, ["https://frames.example/extra.jpg"])).toEqual([{ findings: list, frames: ["https://frames.example/extra.jpg"] }]);
  });

  it("holds every finding once and never passes either limit", () => {
    const list = many(95, 30);
    const batches = batchesOf(list, list.map((f) => f.proofFrame!));
    expect(batches.flatMap((b) => b.findings.map((f) => f.findingId))).toEqual(list.map((f) => f.findingId));
    for (const batch of batches) {
      expect(batch.findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
      expect(batch.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
    }
  });

  it("sends each finding with its own proof frame", () => {
    const list = many(25);
    for (const batch of batchesOf(list, list.map((f) => f.proofFrame!))) for (const f of batch.findings) expect(batch.frames).toContain(f.proofFrame);
  });
});

describe("explain on a walk with more findings than one request holds", () => {
  it("answers all of them, none dropped, with no request over the limits", async () => {
    const list = many(59, 20);
    const { client, requests } = standIn(empties(60));
    const out = await explain(client, input({ findings: list, frames: [...new Set(list.map((f) => f.proofFrame!))] }));
    expect(out.results.map((r) => r.findingId)).toEqual(list.map((f) => f.findingId));
    expect(new Set(requests.flatMap(sentIds)).size).toBe(59);
    for (const request of requests) {
      expect(sentIds(request).length).toBeLessThanOrEqual(MAX_FINDINGS);
      expect(sentFrames(request).length).toBeLessThanOrEqual(MAX_FRAMES);
    }
  });

  it("still sends one request for a walk that fits", async () => {
    const list = many(3, 2);
    const { client, requests } = standIn(empties(2));
    await explain(client, input({ findings: list, frames: ["https://frames.example/0.jpg", "https://frames.example/1.jpg"] }));
    expect(sentIds(requests[0])).toEqual(list.map((f) => f.findingId));
    expect(new Set(requests.map((r) => sentIds(r).join())).size).toBe(1);
  });

  it("carries on past a batch that fails, asking no batch twice over and losing no finding", async () => {
    const list = many(90, 3);
    const answers = [{ findings: [] }, { findings: [] }, "not json", "not json", { findings: [] }, { findings: [] }];
    const { client, requests, ledger } = standIn(answers);
    const out = await explain(client, input({ findings: list, frames: ["https://frames.example/0.jpg", "https://frames.example/1.jpg", "https://frames.example/2.jpg"] }));
    expect(out.results.map((r) => r.findingId)).toEqual(list.map((f) => f.findingId));
    const asked = [...new Set(requests.map((r) => sentIds(r).join()))];
    expect(asked).toHaveLength(3);
    expect(asked.flatMap((ids) => ids.split(",")).sort()).toEqual(list.map((f) => f.findingId).sort());
    expect(requests).toHaveLength(6);
    const linesPerCall = 2;
    expect(ledger.entries.length).toBe(requests.length * linesPerCall);
  });

  it("still reports a batch's refusal when a later batch succeeds, since that batch has template wording", async () => {
    const list = many(50, 2);
    const { client } = standIn(["not json", "not json", { findings: [] }, { findings: [] }]);
    const out = await explain(client, input({ findings: list, frames: ["https://frames.example/0.jpg", "https://frames.example/1.jpg"] }));
    expect(out.refused).toBe("invalid_answer");
  });
});
