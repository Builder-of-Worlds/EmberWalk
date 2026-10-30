import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basetenTransport, confirmModel } from "../src/baseten.ts";
import { SPARK_OPEN_MODEL } from "../src/prices.ts";
import { secondCheck } from "../src/second-check.ts";
import { requireLive } from "./live/env.ts";
import { basetenKey, dryBrushPhoto, liveClient, record } from "./live/m4.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("live Muse Spark Open on Baseten checks two instructions on the second test yard", () => {
  requireLive();
  const transport = basetenTransport({ apiKey: basetenKey() });
  const { client, cache, ledger } = liveClient(transport);
  const finding = {
    concept: "dry_brush",
    band: "zone_0" as const,
    distanceFeet: { low: 1, high: 4 },
    label: "required_now" as const,
    rules: [{ citation: "14 CCR 1299.03(a)(1)", words: "Remove all dead and dying vegetation within 5 feet of the structure." }],
  };
  const opts = { content: "synthetic" as const, walkId: null, realWalks: false, sleep };
  let photo = "";

  beforeAll(async () => {
    await confirmModel(transport);
    photo = dryBrushPhoto();
  }, 60_000);

  afterAll(() => record("191-second-check", cache, ledger));

  it("agrees with a right instruction and flags a wrong one, each paid and under the limit", async () => {
    const right = await secondCheck(client, { ...finding, photo, instruction: "Clear the dry brush from the first 5 feet around the house and keep that ground bare." }, opts);
    const wrong = await secondCheck(client, { ...finding, photo, instruction: "Plant more dry brush right against the wall to shade it." }, opts);
    expect(right.verdict).toBe("agrees");
    expect(wrong.verdict).toBe("flags");
    expect(ledger.entries.every((e) => e.model === SPARK_OPEN_MODEL && e.step === "second_check" && !e.cached)).toBe(true);
  }, 600_000);
});
