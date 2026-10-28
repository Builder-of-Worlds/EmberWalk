import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchTransport, MemoryCache, MemoryLedger, MetaClient } from "@emberwalk/meta";
import { explain } from "../src/index.ts";
import { caseNamed } from "./cases.ts";
import { frameDataUri, syntheticWalk } from "./frames.ts";
import { META_BASE_URL, metaKey, requireLive, REPO } from "./live.ts";
import { liveRecord, writeRecord } from "./record.ts";
import { yardTwo, yardTwoInput, yardTwoProofFrames } from "./support.ts";

const CEILING_USD = 0.1;
const YARD = "test-yard-2";

describe("live Muse Spark explains the second test yard", () => {
  it("answers every finding with wording that passes validation, under the cost ceiling", async () => {
    requireLive();
    expect(yardTwo().synthetic).toBe(true);
    const chosen = caseNamed(process.env["EMBERWALK_EXPLAIN_CASE"]);
    const walk = chosen.frameSeconds.length === 0 ? null : syntheticWalk(path.join(REPO, "fixtures/synthetic", YARD), YARD);
    const frames = walk === null ? [] : chosen.frameSeconds.map((s) => frameDataUri(walk, s));
    const ledger = new MemoryLedger();
    const send = fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() });
    let requests = 0;
    const client = new MetaClient({
      transport: (req) => {
        requests++;
        return send(req);
      },
      cache: new MemoryCache(),
      ledger,
      billing: "free_credits",
    });
    const base = yardTwoInput({ content: "synthetic", language: chosen.language, turns: chosen.turns, frames });
    const out = await explain(client, { ...base, findings: yardTwoProofFrames(base.findings, chosen.frameSeconds, frames) });
    await writeRecord(liveRecord(new Date(), yardTwo().label, out, ledger, requests, chosen));
    expect(out.refused).toBeNull();
    const expected = out.results.map((r) => [r.findingId, r.verdict === "keep" ? "model" : "template", []]);
    expect(out.results.map((r) => [r.findingId, r.wording, r.problems])).toEqual(expected);
    const spent = ledger.entries.reduce((sum, e) => sum + e.totalUsd, 0);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(CEILING_USD);
  }, 180_000);
});
