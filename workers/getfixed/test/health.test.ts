import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

const ask = (path: string, method = "GET"): Promise<Response> =>
  (worker.fetch as (request: Request) => Promise<Response>)(new Request(`https://getfixed.test${path}`, { method }));

describe("the Worker's own address", () => {
  it("answers 200 with status ok at GET /health, for the deploy gate", async () => {
    const res = await ask("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers 404 not_found at every other path and for any other method at /health", async () => {
    for (const [path, method] of [["/", "GET"], ["/health/x", "GET"], ["/healthz", "GET"], ["/health", "POST"]] as const) {
      const res = await ask(path, method);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "not_found", message: "No such endpoint." } });
    }
  });
});
