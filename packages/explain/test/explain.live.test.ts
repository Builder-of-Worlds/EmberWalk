import { describe, expect, it } from "vitest";
import { fetchTransport, MemoryCache, MemoryLedger, MetaClient } from "@emberwalk/meta";
import { explain } from "../src/index.ts";
import { META_BASE_URL, metaKey, requireLive } from "./live.ts";
import { yardTwo, yardTwoInput } from "./support.ts";

const CEILING_USD = 0.1;

describe("live Muse Spark explains the second test yard", () => {
  it("answers every finding with wording that passes validation, under the cost ceiling", async () => {
    requireLive();
    expect(yardTwo().synthetic).toBe(true);
    const ledger = new MemoryLedger();
    const client = new MetaClient({
      transport: fetchTransport({ baseUrl: META_BASE_URL, apiKey: metaKey() }),
      cache: new MemoryCache(),
      ledger,
      billing: "free_credits",
    });
    const out = await explain(client, yardTwoInput({ content: "synthetic" }));
    expect(out.refused).toBeNull();
    expect(out.results.map((r) => [r.findingId, r.wording, r.problems])).toEqual(out.results.map((r) => [r.findingId, "model", []]));
    const spent = ledger.entries.reduce((sum, e) => sum + e.totalUsd, 0);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(CEILING_USD);
  }, 180_000);
});
