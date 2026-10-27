import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("the API Worker the app talks to", () => {
  it("runs here as the real workers/api handler", async () => {
    const response = await exports.default.fetch(new Request("https://app.test/health"));
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
