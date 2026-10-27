import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { d1WalkGate } from "../src/walk-gate.ts";
import { clearWalks, seedWalk, walkState } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";

const gate = () => d1WalkGate(env.DB);

beforeEach(clearWalks);

describe("the D1 walk gate", () => {
  it("reports the state of a known walk and null for an unknown one", async () => {
    await seedWalk(WALK, "uploading");
    await seedWalk(OTHER, "processing", "segment");
    expect(await gate().state(WALK)).toBe("uploading");
    expect(await gate().state(OTHER)).toBe("processing");
    expect(await gate().state("6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff")).toBeNull();
  });

  it("moves an uploading walk to queued and touches no other walk", async () => {
    await seedWalk(WALK, "uploading");
    await seedWalk(OTHER, "uploading");
    await gate().markUploaded(WALK);
    expect(await walkState(WALK)).toBe("queued");
    expect(await walkState(OTHER)).toBe("uploading");
  });

  it("refuses to queue a walk that is not uploading, and leaves it as it was", async () => {
    await seedWalk(WALK, "recording");
    await expect(gate().markUploaded(WALK)).rejects.toThrow(/not waiting/);
    expect(await walkState(WALK)).toBe("recording");
  });

  it("refuses to queue an unknown walk", async () => {
    await expect(gate().markUploaded(WALK)).rejects.toThrow(/not waiting/);
  });
});

describe("the walks table", () => {
  it("refuses a processing walk without a step and a queued walk with one", async () => {
    await expect(seedWalk(WALK, "processing")).rejects.toThrow();
    await expect(seedWalk(WALK, "queued", "segment")).rejects.toThrow();
  });

  it("refuses a state that is not in the shared walk states", async () => {
    await expect(seedWalk(WALK, "paused")).rejects.toThrow();
  });
});
