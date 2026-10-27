import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { metaFor } from "../src/deps.ts";

const ask = (path: string) => worker.fetch(new Request(`https://pipeline.test${path}`) as never);

describe("the pipeline worker's public routes", () => {
  it("answers a health check", async () => {
    const response = await ask("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("has nothing else to serve", async () => {
    const response = await ask("/walks");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("metaFor", () => {
  it("refuses to build a client without the Meta API key", () => {
    expect(() => metaFor(env)).toThrow("key");
  });

  it("bills free credits unless the run is set to paid", () => {
    expect(metaFor({ ...env, META_API_KEY: "test-key" }).billing).toBe("free_credits");
    expect(metaFor({ ...env, META_API_KEY: "test-key", META_BILLING: "paid" }).billing).toBe("paid");
    expect(metaFor({ ...env, META_API_KEY: "test-key", META_BILLING: "anything" }).billing).toBe("free_credits");
  });
});
