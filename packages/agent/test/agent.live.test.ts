import { env } from "cloudflare:workers";
import { d1Ledger, jobCrews, messagesForJob } from "@emberwalk/db";
import { fetchTransport, MemoryCache, MetaClient } from "@emberwalk/meta";
import { beforeEach, describe, expect, it } from "vitest";
import { runJob } from "../src/loop.ts";
import { crew, finding, JOB, resetDb, seedJob, seedWalk } from "./support.ts";

const META_BASE_URL = "https://api.meta.ai/v1";

beforeEach(resetDb);

describe("live Get It Fixed agent on one synthetic job", () => {
  it("finds three sample crews and drafts one request to each with muse-spark-1.3", async () => {
    if (env.EMBERWALK_LIVE !== "1") throw new Error("live tests run only with EMBERWALK_LIVE=1; they cost money");
    if (!env.META_API_KEY) throw new Error("META_API_KEY is in neither .dev.vars nor the environment");
    const [brush] = await seedWalk({ synthetic: true, findings: [finding()] });
    await seedJob("brush_clearing", [brush!.id]);
    const client = new MetaClient({
      transport: fetchTransport({ baseUrl: META_BASE_URL, apiKey: env.META_API_KEY }),
      cache: new MemoryCache(),
      ledger: d1Ledger(env.DB),
      billing: "free_credits",
    });
    const crews = [1, 2, 3, 4].map((n) => crew(n));
    const directory = { near: async (_t: string, _z: string, n: number) => crews.slice(0, n) };
    const photos = { has: async () => true };
    const outcome = await runJob({ enabled: true, client, db: env.DB, directory, photos, now: () => new Date(), newId: () => crypto.randomUUID() }, JOB);
    expect(outcome).toMatchObject({ status: "waiting_on_homeowner", drafts: 3 });
    expect(await jobCrews(env.DB, JOB)).toHaveLength(3);
    expect((await messagesForJob(env.DB, JOB)).every((m) => m.status === "draft")).toBe(true);
  }, 300_000);
});
