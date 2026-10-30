import { describe, expect, it } from "vitest";
import { MemoryCache, MemoryLedger, MetaClient, MetaRefused, PRICE_NANO_USD, REASONING_ROOM, toUsd } from "@emberwalk/meta";
import { limitsWith, LOOP_CONCEPTS, OBJECT_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { checkWalkCost, POINT_LOOKS, rowsForClip, walkCost } from "../src/index.ts";

const SAM_FRAME = 200_000;
const SAM_CALL_60 = 60 * SAM_FRAME;
const LOOK = 5_050_000 + REASONING_ROOM.minimal * PRICE_NANO_USD.sparkOutputToken;

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
  it("gives a loop clip every loop concept and a pan clip the pan concepts, every row one a track can store", () => {
    expect(rowsForClip("loop").map((row) => row.concept).sort()).toEqual([...LOOP_CONCEPTS].sort());
    expect(rowsForClip("pan").map((row) => row.concept).sort()).toEqual([...PAN_CONCEPTS].sort());
    expect([...rowsForClip("loop"), ...rowsForClip("pan")].filter((row) => row.pending !== undefined)).toEqual([]);
  });

  it("asks for the ten yard objects on both kinds, and for the wood deck on the loop only", () => {
    expect(rowsForClip("loop")).toHaveLength(26);
    expect(rowsForClip("pan")).toHaveLength(18);
    const objects = (kind: "loop" | "pan") => rowsForClip(kind).filter((row) => (OBJECT_CONCEPTS as readonly string[]).includes(row.concept));
    expect(objects("loop")).toHaveLength(10);
    expect(objects("pan")).toEqual(objects("loop"));
    expect(rowsForClip("pan").some((row) => row.concept === "wood_deck")).toBe(false);
  });
});

describe("walkCost", () => {
  it("prices a loop clip: one SAM call per row and five Muse Spark looks per pointing row", () => {
    expect(walkCost([loop])).toEqual({ nano: 26 * SAM_CALL_60 + 2 * POINT_LOOKS * LOOK, samCalls: 26, sparkCalls: 2 * POINT_LOOKS });
    expect(walkCost([loop]).nano).toBe(406_020_000);
  });

  it("prices a pan clip, which points only at dry brush", () => {
    expect(walkCost([pan])).toEqual({ nano: 263_010_000, samCalls: 18, sparkCalls: POINT_LOOKS });
  });

  it("prices the ten yard objects and the wood deck as one SAM call each on a loop, with no looks", () => {
    expect(walkCost([loop]).nano - 11 * SAM_CALL_60).toBe(274_020_000);
  });

  it("adds clips together, and bills the SAM minimum of 50 frames to a short clip", () => {
    expect(walkCost([loop, pan]).nano).toBe(406_020_000 + 263_010_000);
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
