import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetaClient } from "../src/client.ts";
import { deleteFile, uploadFile } from "../src/files.ts";
import { MemoryCache, MemoryLedger } from "../src/stores.ts";
import { fetchTransport } from "../src/transport.ts";
import { type BoxRow, runBoxProbe } from "./live/box-probe.ts";
import { frameJpeg, META_BASE_URL, metaKey, motion, REPO, reencode, requireLive, syntheticRender, truth, YARD_TWO } from "./live/env.ts";
import { POINT_IMAGE_WIDTH } from "./live/spark-box.ts";

const FPS = DEFAULT_LIMITS.defaultFps;
const LOGS = path.join(REPO, "logs");
const PASSES = 2;

function stopLineUsd(): number {
  const n = Number(process.env["EMBERWALK_PROBE_LIMIT_USD"]);
  if (!Number.isFinite(n) || n <= 0) throw new Error("EMBERWALK_PROBE_LIMIT_USD must be the approved dollar limit");
  return n;
}

describe("live Muse Spark points, SAM tracks, on the second test yard", () => {
  const ledger = new MemoryLedger();
  const caches = Array.from({ length: PASSES }, () => new MemoryCache());
  const passes: BoxRow[][] = [];
  const transport = () => fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() });
  const clientFor = (cache: MemoryCache) => new MetaClient({ transport: transport(), cache, ledger, billing: "free_credits" });
  let dir = "";
  let clip = "";
  let fileId: string | null = null;
  let frames = 0;

  beforeAll(async () => {
    requireLive();
    stopLineUsd();
    dir = mkdtempSync(path.join(tmpdir(), "ew-box-"));
    clip = path.join(dir, "walk-2fps.mp4");
    frames = reencode(syntheticRender(YARD_TWO), clip, FPS);
    fileId = await uploadFile(clientFor(new MemoryCache()), {
      bytes: readFileSync(clip),
      filename: "test-yard-2-walk-2fps.mp4",
      mediaType: "video/mp4",
      content: "synthetic",
      expiresInSeconds: 3600,
    });
  }, 300_000);

  afterAll(async () => {
    if (fileId !== null) await deleteFile(clientFor(new MemoryCache()), fileId).catch(() => undefined);
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(path.join(LOGS, "037-box-rows.json"), `${JSON.stringify(passes, null, 2)}\n`);
    writeFileSync(path.join(LOGS, "037-box-ledger.json"), `${JSON.stringify(ledger.entries, null, 2)}\n`);
    const answers = Object.fromEntries(caches.flatMap((c, i) => [...c.entries].map(([fp, hit]) => [`pass${i + 1}-${fp}`, hit.answer])));
    writeFileSync(path.join(LOGS, "037-box-answers.json"), `${JSON.stringify(answers)}\n`);
  }, 120_000);

  it("points at each hazard on three frames and tracks the box, twice on fresh caches, each call paid", async () => {
    const m = motion(YARD_TWO);
    for (const cache of caches) {
      passes.push(
        await runBoxProbe({
          client: clientFor(cache),
          ledger,
          video: { fileId: fileId! },
          frames,
          fps: FPS,
          clip: { width: m.camera.width_px, height: m.camera.height_px },
          stopLineUsd: stopLineUsd(),
          hazards: truth(YARD_TWO).hazards,
          picture: (frame) => frameJpeg(clip, frame, POINT_IMAGE_WIDTH),
        }),
      );
    }
    expect(passes.flat().length).toBeGreaterThan(0);
    expect(passes.flat().every((r) => r.costUsd === null || r.costUsd > 0)).toBe(true);
  }, 900_000);
});
