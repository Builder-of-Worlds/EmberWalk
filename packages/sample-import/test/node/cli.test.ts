import { describe, expect, it } from "vitest";
import { REAL_R2_HOST, run } from "../../src/cli.ts";
import type { CliDeps } from "../../src/cli.ts";
import { SYNTHETIC_LABEL } from "../../src/index.ts";
import type { RenderSource } from "../../src/index.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const BYTES = Uint8Array.from({ length: 100 }, (_, i) => i);
const SHA = "a".repeat(64);

const folder = (over: Record<string, unknown> = {}): RenderSource => ({
  async json(name) {
    const common = { synthetic: true, label: SYNTHETIC_LABEL, scene: "yard", fps: 30, duration_s: 1, frame_count: 30 };
    return name === "render.json"
      ? { ...common, schema: "emberwalk.render/1", file: "yard/walk.mp4", size_bytes: 100, sha256: SHA, width: 1920, height: 1080, ...over }
      : { ...common, schema: "emberwalk.motion/1", samples: [{ t: 0, tilt_deg: 1, heading_deg: 2 }] };
  },
  async video() {
    return { sizeBytes: 100, sha256: async () => SHA, read: async (from, to) => BYTES.slice(from, to) };
  },
});

type Seen = { method: string; url: string };

const fakeApi = (partHost: string, seen: Seen[]): CliDeps["fetch"] => async (request) => {
  const url = new URL(request.url);
  seen.push({ method: request.method, url: request.url });
  const expiresAt = "2026-10-27T10:00:00.000Z";
  if (url.pathname === "/api/walks") return Response.json({ walkId: WALK, state: { name: "uploading" } });
  if (url.pathname.endsWith("/tags")) return Response.json({ walkId: WALK, tags: 1 });
  if (url.pathname === "/api/uploads") return Response.json({ uploadId: "up-1", partBytes: 100, partCount: 1, expiresAt });
  if (url.pathname === "/api/uploads/part") {
    return Response.json({ url: `https://${partHost}/part`, method: "PUT", headers: { "content-length": "100" }, expiresAt });
  }
  if (url.pathname === "/api/uploads/complete") return Response.json({ walkId: WALK, bytes: 100 });
  return new Response(null, { status: 200, headers: { etag: '"abc"' } });
};

const harness = (partHost = "storage.test", render: (folder: string) => RenderSource = () => folder()) => {
  const lines: string[] = [];
  const seen: Seen[] = [];
  const deps: CliDeps = { fetch: fakeApi(partHost, seen), render, log: (line) => lines.push(line) };
  return { lines, seen, deps };
};

const ARGS = ["--origin", "https://api.test", "--render", "/renders/yard"];

describe("the import command", () => {
  it("imports and says which walk was sent", async () => {
    const { lines, deps } = harness();
    expect(await run(ARGS, deps)).toBe(0);
    expect(lines).toEqual([`IMPORT walk ${WALK} sent: 100 bytes in 1 parts, 1 tag`]);
  });

  it("opens the render folder it was given", async () => {
    const opened: string[] = [];
    const { deps } = harness("storage.test", (path) => {
      opened.push(path);
      return folder();
    });
    await run(ARGS, deps);
    expect(opened).toEqual(["/renders/yard"]);
  });

  it("accepts the flags in either order and plain http for a local API", async () => {
    const { deps } = harness();
    expect(await run(["--render", "/r", "--origin", "http://127.0.0.1:8787"], deps)).toBe(0);
  });

  it.each([
    ["no flags", []],
    ["no render folder", ["--origin", "https://api.test"]],
    ["no origin", ["--render", "/r"]],
    ["an origin flag with no value", ["--render", "/r", "--origin"]],
    ["an origin flag followed by another flag", ["--origin", "--render", "/r"]],
    ["a flag given twice", [...ARGS, "--origin", "https://other.test"]],
    ["a flag it does not know", [...ARGS, "--fast"]],
    ["a bare word", [...ARGS, "now"]],
    ["an origin that is not a URL", ["--origin", "api.test", "--render", "/r"]],
    ["an origin that is not http or https", ["--origin", "ftp://api.test", "--render", "/r"]],
  ])("prints the usage and sends nothing for %s", async (_name, argv) => {
    const { lines, seen, deps } = harness();
    expect(await run(argv, deps)).toBe(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("usage: npm run import");
    expect(seen).toEqual([]);
  });

  it("reports a refused render with its code and sends nothing", async () => {
    const { lines, seen, deps } = harness("storage.test", () => folder({ synthetic: false }));
    expect(await run(ARGS, deps)).toBe(1);
    expect(lines).toEqual(["IMPORT refused: not_synthetic: render.json is not marked synthetic."]);
    expect(seen).toEqual([]);
  });

  it("lets a failure that is not a refusal through", async () => {
    const { deps } = harness("storage.test", () => {
      throw new Error("boom");
    });
    await expect(run(ARGS, deps)).rejects.toThrow("boom");
  });
});

describe("the guard against writing to a real R2 bucket", () => {
  const REAL = "755646338ba02dbe2d3409c5a557fa15.r2.cloudflarestorage.com";

  it("matches the account hosts of R2 and nothing else", () => {
    expect(REAL_R2_HOST.test(REAL)).toBe(true);
    expect(REAL_R2_HOST.test("r2.cloudflarestorage.com.evil.test")).toBe(false);
    expect(REAL_R2_HOST.test("storage.test")).toBe(false);
  });

  it("refuses a part link to a real bucket and writes nothing", async () => {
    const { lines, seen, deps } = harness(REAL);
    expect(await run(ARGS, deps)).toBe(1);
    expect(lines[0]).toContain("IMPORT refused: real_r2_refused:");
    expect(seen.filter((s) => s.method === "PUT")).toEqual([]);
  });

  it("writes to a real bucket only when told to", async () => {
    const { lines, seen, deps } = harness(REAL);
    expect(await run([...ARGS, "--allow-real-r2"], deps)).toBe(0);
    expect(lines[0]).toContain("sent");
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(1);
  });

  it("lets a part go to a host that is not R2", async () => {
    const { seen, deps } = harness("storage.test");
    await run(ARGS, deps);
    expect(seen.filter((s) => s.method === "PUT")).toHaveLength(1);
  });
});
