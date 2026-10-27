import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetaClient } from "../src/client.ts";
import { deleteFile, uploadFile } from "../src/files.ts";
import { MemoryCache, MemoryLedger } from "../src/stores.ts";
import { fetchTransport } from "../src/transport.ts";
import { META_BASE_URL, metaKey, motion, REPO, reencode, requireLive, syntheticRender, truth } from "./live/env.ts";
import { type ProbeRow, runProbe } from "./live/probe.ts";

const FPS = DEFAULT_LIMITS.defaultFps;
const LOGS = path.join(REPO, "logs");
const PASSES = 2;

function stopLineUsd(): number {
  const n = Number(process.env["EMBERWALK_PROBE_LIMIT_USD"]);
  if (!Number.isFinite(n) || n <= 0) throw new Error("EMBERWALK_PROBE_LIMIT_USD must be the approved dollar limit");
  return n;
}

describe("live SAM phrase probe on the synthetic test render", () => {
  const ledger = new MemoryLedger();
  const caches = Array.from({ length: PASSES }, () => new MemoryCache());
  const passes: ProbeRow[][] = [];
  const transport = () => fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() });
  const clientFor = (cache: MemoryCache) => new MetaClient({ transport: transport(), cache, ledger, billing: "free_credits" });
  let dir = "";
  let fileId: string | null = null;
  let frames = 0;

  beforeAll(async () => {
    requireLive();
    stopLineUsd();
    dir = mkdtempSync(path.join(tmpdir(), "ew-phrases-"));
    const clip = path.join(dir, "walk-2fps.mp4");
    frames = reencode(syntheticRender(), clip, FPS);
    fileId = await uploadFile(clientFor(new MemoryCache()), {
      bytes: readFileSync(clip),
      filename: "test-yard-walk-2fps.mp4",
      mediaType: "video/mp4",
      content: "synthetic",
      expiresInSeconds: 3600,
    });
  }, 300_000);

  afterAll(async () => {
    if (fileId !== null) await deleteFile(clientFor(new MemoryCache()), fileId).catch(() => undefined);
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(path.join(LOGS, "023-phrases-rows.json"), `${JSON.stringify(passes, null, 2)}\n`);
    writeFileSync(path.join(LOGS, "023-phrases-ledger.json"), `${JSON.stringify(ledger.entries, null, 2)}\n`);
    const answers = Object.fromEntries([...caches[0]!.entries].map(([fp, hit]) => [fp, hit.answer]));
    writeFileSync(path.join(LOGS, "023-phrases-answers.json"), `${JSON.stringify(answers)}\n`);
  }, 120_000);

  it("asks SAM for every candidate phrase twice on fresh caches, each call paid", async () => {
    for (const cache of caches) {
      passes.push(
        await runProbe({
          client: clientFor(cache),
          ledger,
          video: { fileId: fileId! },
          frames,
          fps: FPS,
          stopLineUsd: stopLineUsd(),
          hazards: truth().hazards,
          motion: motion(),
        }),
      );
    }
    expect(passes.flat().length).toBeGreaterThan(0);
    expect(passes.flat().every((r) => !r.cached && r.costUsd > 0)).toBe(true);
  }, 900_000);
});
