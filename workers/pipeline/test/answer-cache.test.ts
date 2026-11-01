import { cacheMarkKey, cacheMarksPrefix } from "@emberwalk/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { r2Cache } from "../src/deps.ts";
import { resetAll } from "./fixtures.ts";

beforeEach(resetAll);

const FP = "c".repeat(64);
const WALK = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const marked = async (walkId: string): Promise<string[]> => (await env.MEDIA.list({ prefix: cacheMarksPrefix(walkId) })).objects.map((o) => o.key);

describe("the answer cache in R2", () => {
  it("marks a stored answer under the walk that asked, and serves it back", async () => {
    const cache = r2Cache(env.DB, env.MEDIA);
    await cache.put(FP, "sam", { n: 1 }, WALK);
    expect(await cache.get(FP)).toEqual({ n: 1 });
    expect(await marked(WALK)).toEqual([cacheMarkKey(WALK, FP)]);
  });

  it("marks a reused answer under the second walk too, and marks nothing for a call with no walk", async () => {
    const cache = r2Cache(env.DB, env.MEDIA);
    await cache.put(FP, "sam", { n: 1 }, null);
    expect(await marked(WALK)).toEqual([]);
    await cache.mark(FP, OTHER);
    expect(await marked(OTHER)).toEqual([cacheMarkKey(OTHER, FP)]);
    expect(await marked(WALK)).toEqual([]);
  });
});
