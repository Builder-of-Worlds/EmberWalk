import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetaClient } from "../src/client.ts";
import { deleteFile, uploadFile } from "../src/files.ts";
import { PRICE_NANO_USD, toUsd } from "../src/prices.ts";
import { samVideoCall, type SamAnswer } from "../src/sam.ts";
import { MemoryCache, MemoryLedger } from "../src/stores.ts";
import { judgeDetection, sparkToolCall, type Tool, withToolResults } from "../src/tools.ts";
import { fetchTransport } from "../src/transport.ts";
import { matchHazard, META_BASE_URL, metaKey, MIN_IOU, motion, reencode, REPO, requireLive, syntheticRender, truth } from "./live/env.ts";

const FPS = DEFAULT_LIMITS.defaultFps;
const LOGS = path.join(REPO, "logs");

describe("live Meta run on the synthetic test render", () => {
  const cache = new MemoryCache();
  const ledger = new MemoryLedger();
  let client: MetaClient;
  let dir = "";
  let fileId: string | null = null;
  let frames = 0;
  const answers = new Map<string, SamAnswer>();

  beforeAll(async () => {
    requireLive();
    client = new MetaClient({ transport: fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() }), cache, ledger, billing: "free_credits" });
    dir = mkdtempSync(path.join(tmpdir(), "ew-live-"));
    const clip = path.join(dir, "walk-2fps.mp4");
    frames = reencode(syntheticRender(), clip, FPS);
    fileId = await uploadFile(client, {
      bytes: readFileSync(clip),
      filename: "test-yard-walk-2fps.mp4",
      mediaType: "video/mp4",
      content: "synthetic",
      expiresInSeconds: 3600,
    });
  }, 300_000);

  afterAll(async () => {
    if (fileId !== null) await deleteFile(client, fileId).catch(() => undefined);
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(path.join(LOGS, "017-live-ledger.json"), `${JSON.stringify(ledger.entries, null, 2)}\n`);
    writeFileSync(path.join(LOGS, "017-live-answers.json"), `${JSON.stringify([...cache.entries.values()], null, 2)}\n`);
  }, 120_000);

  it("SAM finds each planted hazard on the frames where the truth file says it is visible", async () => {
    const t = truth();
    expect(t.synthetic).toBe(true);
    const m = motion();
    const report: string[] = [];
    for (const hazard of t.hazards) {
      const a = await client.call(samVideoCall({ video: { fileId: fileId! }, concept: hazard.concept, frames, content: "synthetic" }));
      answers.set(hazard.id, a.value);
      const { window, hits, elsewhere, bestIou } = matchHazard(hazard, a.value.frames, m, FPS);
      const ious = window.map((f) => (bestIou.get(f) ?? 0).toFixed(2)).join(" ");
      report.push(`${hazard.id} "${hazard.concept}": ${hits.length}/${window.length} window frames hit at IoU ${MIN_IOU}, ${elsewhere.length} frames with objects off the hazard, ${a.costUsd} USD; window IoU: ${ious}`);
      expect.soft(hits.length, `${hazard.id} found on too few of its frames`).toBeGreaterThanOrEqual(Math.ceil(window.length / 2));
    }
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(path.join(LOGS, "017-live-sam.txt"), `${report.join("\n")}\n`);
  }, 600_000);

  it("serves the same three requests again from cache at zero cost", async () => {
    for (const hazard of truth().hazards) {
      const a = await client.call(samVideoCall({ video: { fileId: fileId! }, concept: hazard.concept, frames, content: "synthetic" }));
      expect(a).toMatchObject({ cached: true, costUsd: 0 });
    }
  }, 600_000);

  it("completes one Muse Spark tool call round trip whose arguments pass the schema", async () => {
    const brush = answers.get("dry-brush-1");
    const frame = brush?.frames.find((f) => f.objects.length > 0)?.frame ?? 20;
    const input = [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `A synthetic sample house. SAM 3.1 tracked "dry brush" on frame ${frame} of a backyard walk: brown, leafless branches on bare soil about five feet from the wall. Call judge_detection once for it.`,
          },
        ],
      },
    ];
    const base = {
      instructions: "You check wildfire hazards found in a yard video. Always answer by calling judge_detection exactly once.",
      content: "synthetic" as const,
      inputTokenEstimate: 4000,
      maxOutputTokens: 2000,
      step: "score" as const,
    };
    const tools = [judgeDetection] as Tool<unknown>[];
    const turn = await client.call(sparkToolCall({ ...base, input }, tools));
    expect(turn.value.uses).toHaveLength(1);
    expect(turn.value.uses[0]).toMatchObject({ name: "judge_detection", args: { concept: "dry_brush" } });
    const results = { [turn.value.uses[0]!.callId]: { saved: true } };
    const final = await client.call(sparkToolCall({ ...base, input: withToolResults(input, turn.value, results) }, tools));
    expect(final.value.uses).toEqual([]);
    expect(final.value.text.trim()).not.toBe("");
  }, 300_000);

  it("prices every ledger line at the models.md section 5 rates", async () => {
    const paid = ledger.entries.filter((e) => !e.cached);
    expect(paid.length).toBeGreaterThan(0);
    for (const e of paid) {
      if (e.model === "sam-3.1") {
        expect(e.units.kind).toBe("frames");
        expect(e.unitPriceUsd).toBe(toUsd(PRICE_NANO_USD.samVideoFrame));
        expect(e.units.count).toBeGreaterThanOrEqual(50);
      } else {
        expect(e.units.kind).toBe("tokens");
        expect([1.25e-6, 0.15e-6, 4.25e-6]).toContain(e.unitPriceUsd);
      }
      expect(e.totalUsd).toBeCloseTo(e.units.count * e.unitPriceUsd, 12);
    }
    expect(ledger.entries.filter((e) => e.cached).every((e) => e.totalUsd === 0)).toBe(true);
    expect(await ledger.spentUsd(new Date().toISOString().slice(0, 10))).toBeLessThan(DEFAULT_LIMITS.dailySpendUsd);
  });
});
