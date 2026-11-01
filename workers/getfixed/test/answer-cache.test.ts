import { env } from "cloudflare:workers";
import { cacheMarkKey, cacheMarksPrefix } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { r2Cache } from "../src/deps.ts";
import { resetDb } from "./harness.ts";

const FP = "d".repeat(64);
const WALK = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";

const marked = async (walkId: string): Promise<string[]> => (await env.MEDIA.list({ prefix: cacheMarksPrefix(walkId) })).objects.map((o) => o.key);

beforeEach(async () => {
  await resetDb();
  for (const walkId of [WALK, OTHER]) for (const key of await marked(walkId)) await env.MEDIA.delete(key);
});

describe("the Get It Fixed answer cache in R2", () => {
  it("marks a stored answer under the walk that asked, and serves it back", async () => {
    const cache = r2Cache(env.DB, env.MEDIA);
    await cache.put(FP, "muse-spark", { n: 1 }, WALK);
    expect(await cache.get(FP)).toEqual({ n: 1 });
    expect(await marked(WALK)).toEqual([cacheMarkKey(WALK, FP)]);
  });

  it("marks a reused answer under the second walk, and nothing for a call with no walk", async () => {
    const cache = r2Cache(env.DB, env.MEDIA);
    await cache.put(FP, "muse-spark", { n: 1 }, null);
    expect(await marked(WALK)).toEqual([]);
    await cache.mark(FP, OTHER);
    expect(await marked(OTHER)).toEqual([cacheMarkKey(OTHER, FP)]);
  });
});
