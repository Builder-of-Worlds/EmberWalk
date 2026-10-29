import { describe, expect, it } from "vitest";
import { MemoryCache, MemoryLedger, MetaClient, MetaRefused, toUsd } from "@emberwalk/meta";
import { limitsWith } from "@emberwalk/shared";
import { checkWalkCost, POINT_LOOKS, rowsForClip, walkCost } from "../src/index.ts";

const SAM_FRAME = 200_000;
const SAM_CALL_60 = 60 * SAM_FRAME;
const LOOK = 5_050_000;

const loop = { kind: "loop", frameCount: 60 } as const;
const pan = { kind: "pan", frameCount: 60 } as const;

const clientWithCap = (capNano: number): MetaClient =>
  new MetaClient({
    transport: async () => {
      throw new Error("the cost check must not send a request");
    },
    cache: new MemoryCache(),
    ledger: new MemoryLedger(),
    billing: "free_credits",
    limits: limitsWith({ dailySpendUsd: toUsd(capNano) }),
  });

describe("rowsForClip", () => {
  it("gives a loop clip every existing concept and a pan clip the pan concepts", () => {
    expect(rowsForClip("loop").filter((row) => row.pending === undefined)).toHaveLength(15);
    expect(rowsForClip("pan").filter((row) => row.pending === undefined)).toHaveLength(8);
  });

  it("adds every pending object to both kinds", () => {
    expect(rowsForClip("loop")).toHaveLength(25);
    expect(rowsForClip("pan")).toHaveLength(18);
    expect(rowsForClip("pan").filter((row) => row.pending !== undefined)).toEqual(rowsForClip("loop").filter((row) => row.pending !== undefined));
  });
});

describe("walkCost", () => {
  it("prices a loop clip: one SAM call per row and five Muse Spark looks per pointing row", () => {
    expect(walkCost([loop])).toEqual({ nano: 25 * SAM_CALL_60 + 2 * POINT_LOOKS * LOOK, samCalls: 25, sparkCalls: 2 * POINT_LOOKS });
    expect(walkCost([loop]).nano).toBe(350_500_000);
  });

  it("prices a pan clip, which points only at dry brush", () => {
    expect(walkCost([pan])).toEqual({ nano: 241_250_000, samCalls: 18, sparkCalls: POINT_LOOKS });
  });

  it("prices the ten pending objects as one SAM call each, with no looks", () => {
    const pending = rowsForClip("loop").filter((row) => row.pending !== undefined).length;
    expect(pending).toBe(10);
    expect(walkCost([loop]).nano - pending * SAM_CALL_60).toBe(230_500_000);
  });

  it("adds clips together, and bills the SAM minimum of 50 frames to a short clip", () => {
    expect(walkCost([loop, pan]).nano).toBe(350_500_000 + 241_250_000);
    expect(walkCost([{ kind: "pan", frameCount: 10 }]).nano).toBe(walkCost([{ kind: "pan", frameCount: 50 }]).nano);
    expect(walkCost([{ kind: "pan", frameCount: 51 }]).nano).toBeGreaterThan(walkCost([{ kind: "pan", frameCount: 50 }]).nano);
  });

  it("prices no clips at nothing", () => {
    expect(walkCost([])).toEqual({ nano: 0, samCalls: 0, sparkCalls: 0 });
  });
});

describe("checkWalkCost", () => {
  it("passes a walk whose estimate equals the cap", async () => {
    const estimate = walkCost([loop]).nano;

    await expect(checkWalkCost(clientWithCap(estimate), estimate)).resolves.toBeUndefined();
  });

  it("refuses a walk one nano over the cap, naming the daily cap", async () => {
    const estimate = walkCost([loop]).nano;

    await expect(checkWalkCost(clientWithCap(estimate - 1), estimate)).rejects.toThrow(MetaRefused);
    await expect(checkWalkCost(clientWithCap(estimate - 1), estimate)).rejects.toMatchObject({ reason: "daily_cap_reached" });
  });

  it("holds nothing back once it has checked", async () => {
    const estimate = walkCost([loop]).nano;
    const client = clientWithCap(estimate);

    await checkWalkCost(client, estimate);
    await checkWalkCost(client, estimate);
  });
});
